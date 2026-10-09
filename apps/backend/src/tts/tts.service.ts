import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import axios from "axios";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { RedisService } from "../redis/redis.service";
import { withTimeout } from "../utils/timeout.utils";

const AZURE_COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default";
// MP3 mono, débit correct pour de l'annonce vocale.
const SPEECH_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// Chemin REST de synthèse sur l'hôte à sous-domaine custom (auth AAD).
// ⚠️ c'est bien /tts/cognitiveservices/v1 : sur l'hôte {custom}.cognitiveservices.azure.com,
// /cognitiveservices/v1 (sans /tts) renvoie 404. Validé par test direct 2026-07-12.
const SPEECH_SYNTH_PATH = "/tts/cognitiveservices/v1";
// Léger ralentissement : une annonce de compétition gagne en clarté et sonne
// moins « débitée » qu'au débit par défaut de la voix neuronale. Appliqué
// uniquement aux voix qui acceptent <prosody> (pas les voix HD).
const SPEECH_PROSODY_RATE = "-5%";
// Sel de la clé de cache : bumpé quand l'audio produit pour un même texte
// change, pour ne pas resservir l'ancien audio.
// v2 = plus de réécriture Gemini + SSML prosody.
// v3 = voix « MC » plus naturelle + SSML adapté aux capacités de la voix ; la
// clé hashe désormais le SSML complet (voix, style, prosodie inclus).
const CACHE_KEY_SALT = "azure-v3";
// Voix par défaut : la plus naturelle servie par notre ressource Speech
// (northeurope). Les voix HD (DragonHD, MAI) n'y sont PAS disponibles ; les
// voix « Multilingual » sont la génération neuronale la plus récente
// (intonation conversationnelle, nettement moins « robot » que Denise).
const DEFAULT_VOICE = "fr-FR-VivienneMultilingualNeural";
// Voix de repli quand le service refuse la voix configurée (HTTP 400 : voix
// inconnue ou non servie dans la région) : on dégrade au lieu de couper les
// annonces.
const FALLBACK_VOICE = "fr-FR-DeniseNeural";
// Style d'annonceur (<mstts:express-as>), appliqué seulement si la voix le
// supporte en français. Surcharge : AZURE_SPEECH_STYLE (« none » = aucun).
const DEFAULT_STYLE = "excited";
const NO_STYLE = "none";

export type VoiceFamily =
  | "neural"
  | "multilingual"
  | "dragon-hd"
  | "dragon-hd-omni"
  | "mai";

export interface VoiceCapabilities {
  family: VoiceFamily;
  /** <prosody> accepté (refusé par toutes les voix HD). */
  prosody: boolean;
  /** Styles <mstts:express-as> supportés EN FRANÇAIS par cette voix. */
  styles: readonly string[];
  /** <lang xml:lang> : fixe l'accent des voix multilingues / HD. */
  langTag: boolean;
}

// Styles des voix fr-FR (doc Azure « language-support », onglet TTS). Les
// autres voix fr-FR standard, les Multilingual et les DragonHD n'en ont aucun.
const NEURAL_STYLES: Readonly<Record<string, readonly string[]>> = {
  "fr-fr-deniseneural": ["cheerful", "excited", "sad", "whispering"],
  "fr-fr-henrineural": ["cheerful", "excited", "sad", "whispering"],
};
const MAI_STYLES: readonly string[] = [
  "angry",
  "confused",
  "determined",
  "disgusted",
  "embarrassed",
  "excited",
  "fearful",
  "happy",
  "hopeful",
  "jealous",
  "joyful",
  "regretful",
  "relieved",
  "sad",
  "shouting",
  "softvoice",
  "surprised",
  "whispering",
];

/**
 * Capacités SSML d'une voix, déduites de son nom (doc Azure HD voices) :
 * - `xx-XX-Nom:DragonHDOmniLatestNeural` → HD Omni : ni prosody ; styles
 *   documentés pour l'anglais seulement → aucun appliqué en français
 * - `xx-XX-Nom:DragonHDLatestNeural` → DragonHD : ni prosody ni express-as
 * - `xx-XX-Nom:MAI-Voice-2[-Flash]` → MAI : styles ; prosody non garantie
 * - `…MultilingualNeural` → neuronale multilingue : prosody, pas de style
 * - sinon neuronale standard : prosody, styles selon la table
 */
export function voiceCapabilities(voice: string): VoiceCapabilities {
  const v = voice.toLowerCase();
  if (v.includes(":dragonhdomni")) {
    return {
      family: "dragon-hd-omni",
      prosody: false,
      styles: [],
      langTag: true,
    };
  }
  if (v.includes(":dragonhd")) {
    return { family: "dragon-hd", prosody: false, styles: [], langTag: true };
  }
  if (v.includes(":mai-voice")) {
    return {
      family: "mai",
      prosody: false,
      styles: MAI_STYLES,
      langTag: false,
    };
  }
  if (v.endsWith("multilingualneural")) {
    return { family: "multilingual", prosody: true, styles: [], langTag: true };
  }
  return {
    family: "neural",
    prosody: true,
    styles: NEURAL_STYLES[v] ?? [],
    langTag: false,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * SSML de synthèse, adapté aux capacités de la voix (cf. voiceCapabilities) :
 * prosody seulement si acceptée, express-as seulement si la voix supporte le
 * style demandé, <lang> pour garder l'accent français des voix multilingues
 * (sinon « samba », « quickstep »… peuvent basculer en accent étranger).
 * Le texte est échappé (caractères XML uniquement) : la ponctuation et les
 * points de suspension « … » sont conservés tels quels, ce sont eux qui donnent
 * les pauses naturelles de l'annonce.
 */
export function buildSsml(text: string, voice: string, style?: string): string {
  const lang = voice.split("-").slice(0, 2).join("-") || "fr-FR";
  const caps = voiceCapabilities(voice);

  let body = escapeXml(text);
  if (caps.prosody) {
    body = `<prosody rate='${SPEECH_PROSODY_RATE}'>${body}</prosody>`;
  }
  if (style && caps.styles.includes(style)) {
    body = `<mstts:express-as style='${escapeXml(style)}'>${body}</mstts:express-as>`;
  }
  if (caps.langTag) {
    body = `<lang xml:lang='${escapeXml(lang)}'>${body}</lang>`;
  }

  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' ` +
    `xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='${escapeXml(lang)}'>` +
    `<voice name='${escapeXml(voice)}'>${body}</voice></speak>`
  );
}

/** Le service a refusé la requête elle-même (voix inconnue / hors région). */
function isVoiceRejected(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 400;
}

@Injectable()
export class TtsService implements OnModuleInit {
  private credential?: TokenCredential;
  private speechEndpoint?: string;
  private speechResourceId?: string;
  // Voix refusées (400) depuis le démarrage : on passe directement au repli
  // pour ne pas réessuyer un échec à chaque annonce (ni ouvrir le breaker).
  private readonly rejectedVoices = new Set<string>();
  private readonly logger = new Logger(TtsService.name);
  private readonly cacheDir = path.join(process.cwd(), "uploads", "tts_cache");
  private readonly REDIS_CACHE_TTL = 30 * 24 * 3600; // 30 days

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
    private circuitBreakerService: CircuitBreakerService,
  ) {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  onModuleInit(): void {
    // Azure Speech (synthèse) — managed identity, aucune clé téléchargée.
    this.speechEndpoint = this.configService
      .get<string>("AZURE_SPEECH_ENDPOINT")
      ?.replace(/\/+$/, "");
    // ARM resource id du compte Speech — nécessaire pour l'auth Entra ID de
    // Speech, qui exige un token encapsulé "aad#{resourceId}#{token}".
    this.speechResourceId = this.configService.get<string>(
      "AZURE_SPEECH_RESOURCE_ID",
    );
    if (this.speechEndpoint) {
      this.credential = new DefaultAzureCredential();
      this.logger.log("Azure Speech TTS initialized (managed identity)");
    } else {
      this.logger.warn(
        "AZURE_SPEECH_ENDPOINT not set. TTS synthesis will fail until configured.",
      );
    }
  }

  /**
   * Formes d'Authorization à tenter, dans l'ordre.
   *
   * Spécificité Azure **Speech** : contrairement aux autres services Cognitive
   * (Vision, Language…) qui acceptent un bearer AAD brut, le plan de données de
   * Speech attend le token **encapsulé** `aad#{resourceId}#{token}`
   * (cf. how-to-configure-azure-ad-auth). On envoie donc cette forme en premier
   * quand on connaît le resourceId, puis on retombe sur le token brut — ainsi le
   * premier appel réel réussit quelle que soit la forme acceptée par le service.
   */
  private buildAuthValues(aadToken: string): string[] {
    const wrapped = this.speechResourceId
      ? `aad#${this.speechResourceId}#${aadToken}`
      : undefined;
    return wrapped ? [wrapped, aadToken] : [aadToken];
  }

  /**
   * Seam testable : SSML → audio MP3 (Buffer) via Azure Speech REST.
   * L'auth Speech est validée à l'exécution (essai aad#… puis token brut sur
   * 401/403). Tout est isolé dans cette seule méthode.
   */
  private async synthesize(ssml: string): Promise<Buffer> {
    const token = await this.credential!.getToken(AZURE_COGNITIVE_SCOPE);
    if (!token) throw new Error("Failed to acquire Azure AD token for Speech");

    const authValues = this.buildAuthValues(token.token);
    let lastErr: unknown;
    for (let i = 0; i < authValues.length; i++) {
      try {
        const res = await axios.post<ArrayBuffer>(
          `${this.speechEndpoint}${SPEECH_SYNTH_PATH}`,
          ssml,
          {
            headers: {
              Authorization: `Bearer ${authValues[i]}`,
              "Content-Type": "application/ssml+xml",
              "X-Microsoft-OutputFormat": SPEECH_OUTPUT_FORMAT,
              "User-Agent": "ffd-connect",
            },
            responseType: "arraybuffer",
          },
        );
        return Buffer.from(res.data);
      } catch (err) {
        lastErr = err;
        const status = axios.isAxiosError(err)
          ? err.response?.status
          : undefined;
        // Seul un rejet d'auth (401/403) justifie d'essayer la forme suivante ;
        // toute autre erreur (réseau, 4xx, 5xx) est réelle et remonte aussitôt.
        const isAuthReject = status === 401 || status === 403;
        if (!isAuthReject || i === authValues.length - 1) throw err;
        this.logger.warn(
          `Speech auth rejected (${status}) with form #${i + 1}/${authValues.length}; retrying with fallback auth form`,
        );
      }
    }
    throw lastErr;
  }

  /** Style d'annonce configuré (undefined = aucun). */
  private resolveStyle(): string | undefined {
    const style =
      this.configService.get<string>("AZURE_SPEECH_STYLE") ?? DEFAULT_STYLE;
    return style === NO_STYLE ? undefined : style;
  }

  /**
   * Génère un fichier audio MP3 à partir d'un texte via Azure Speech.
   * Le texte est prononcé tel quel (annonces rédigées en français naturel côté
   * client) : plus aucune réécriture LLM avant synthèse.
   * Si la voix configurée est refusée par le service (400), on retombe sur
   * FALLBACK_VOICE plutôt que de couper les annonces.
   */
  async getTtsAudio(text: string): Promise<string> {
    const configured =
      this.configService.get<string>("AZURE_SPEECH_VOICE") ?? DEFAULT_VOICE;
    const style = this.resolveStyle();
    const canFallBack = configured !== FALLBACK_VOICE;

    if (canFallBack && this.rejectedVoices.has(configured)) {
      return this.getOrSynthesize(text, FALLBACK_VOICE, style);
    }
    try {
      return await this.getOrSynthesize(text, configured, style);
    } catch (err) {
      if (!canFallBack || !isVoiceRejected(err)) throw err;
      this.rejectedVoices.add(configured);
      this.logger.warn(
        `Speech rejected voice "${configured}" (400); falling back to ${FALLBACK_VOICE}`,
      );
      return this.getOrSynthesize(text, FALLBACK_VOICE, style);
    }
  }

  /**
   * Cache hybride : fichier local (le plus rapide) → Redis (partagé) →
   * génération. La clé hashe le SSML complet : changer de voix, de style ou de
   * prosodie produit naturellement une nouvelle entrée.
   */
  private async getOrSynthesize(
    text: string,
    voice: string,
    style: string | undefined,
  ): Promise<string> {
    const ssml = buildSsml(text, voice, style);
    const hash = crypto
      .createHash("md5")
      .update(ssml + CACHE_KEY_SALT)
      .digest("hex");
    const filePath = path.join(this.cacheDir, `${hash}.mp3`);

    // 1. Check file system cache first (fastest)
    if (fs.existsSync(filePath)) {
      this.logger.log(`[FS Cache Hit] ${text.substring(0, 30)}...`);
      return filePath;
    }

    // 2. Check Redis cache (shared across instances)
    const redisKey = `tts:${hash}`;
    const cachedPath = await this.redisService.get(redisKey);
    if (cachedPath && fs.existsSync(cachedPath)) {
      this.logger.log(`[Redis Cache Hit] ${text.substring(0, 30)}...`);
      return cachedPath;
    }

    this.logger.log(`Generating new audio (Azure TTS, ${voice}) for: ${text}`);

    const audioContent = await this.circuitBreakerService.fire(
      "azure-tts",
      () => withTimeout(this.synthesize(ssml), 10_000, "Azure TTS synthesize"),
    );

    if (!audioContent || audioContent.length === 0) {
      throw new Error("No audio content received from Azure TTS");
    }

    await fs.promises.writeFile(filePath, audioContent, "binary");

    // 3. Save to Redis cache for future requests
    await this.redisService.set(redisKey, filePath, this.REDIS_CACHE_TTL);
    this.logger.log(`[Cache Saved] ${text.substring(0, 30)}... → Redis + FS`);

    return filePath;
  }
}
