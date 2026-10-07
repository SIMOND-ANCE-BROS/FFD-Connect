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
// moins « débitée » qu'au débit par défaut de la voix neuronale.
const SPEECH_PROSODY_RATE = "-5%";
// Sel de la clé de cache : bumpé quand le texte réellement synthétisé change
// (v2 = plus de réécriture Gemini + SSML prosody), pour ne pas resservir
// l'ancien audio.
const CACHE_KEY_SALT = "azure-v2";
const DEFAULT_VOICE = "fr-FR-DeniseNeural";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * SSML de synthèse. Le texte est échappé (caractères XML uniquement) : la
 * ponctuation et les points de suspension « … » sont conservés tels quels, ce
 * sont eux qui donnent les pauses naturelles de l'annonce.
 */
export function buildSsml(text: string, voice: string): string {
  const lang = voice.split("-").slice(0, 2).join("-") || "fr-FR";
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' ` +
    `xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='${escapeXml(lang)}'>` +
    `<voice name='${escapeXml(voice)}'>` +
    `<prosody rate='${SPEECH_PROSODY_RATE}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`
  );
}

@Injectable()
export class TtsService implements OnModuleInit {
  private credential?: TokenCredential;
  private speechEndpoint?: string;
  private speechResourceId?: string;
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
   * Seam testable : texte → audio MP3 (Buffer) via Azure Speech REST.
   * L'auth Speech est validée à l'exécution (essai aad#… puis token brut sur
   * 401/403). Tout est isolé dans cette seule méthode.
   */
  private async synthesize(text: string, voice: string): Promise<Buffer> {
    const token = await this.credential!.getToken(AZURE_COGNITIVE_SCOPE);
    if (!token) throw new Error("Failed to acquire Azure AD token for Speech");

    const ssml = buildSsml(text, voice);

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

  /**
   * Génère un fichier audio MP3 à partir d'un texte via Azure Speech.
   * Le texte est prononcé tel quel (annonces rédigées en français naturel côté
   * client) : plus aucune réécriture LLM avant synthèse.
   * Cache hybride : fichier local (le plus rapide) → Redis (partagé) → génération.
   */
  async getTtsAudio(text: string): Promise<string> {
    const voice =
      this.configService.get<string>("AZURE_SPEECH_VOICE") ?? DEFAULT_VOICE;
    const hash = crypto
      .createHash("md5")
      .update(text + voice + CACHE_KEY_SALT)
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

    this.logger.log(`Generating new audio (Azure TTS) for: ${text}`);

    const audioContent = await this.circuitBreakerService.fire(
      "azure-tts",
      () =>
        withTimeout(
          this.synthesize(text, voice),
          10_000,
          "Azure TTS synthesize",
        ),
    );

    if (!audioContent || audioContent.length === 0) {
      throw new Error("No audio content received from Azure TTS");
    }

    await fs.promises.writeFile(filePath, audioContent, "binary");

    // 4. Save to Redis cache for future requests
    await this.redisService.set(redisKey, filePath, this.REDIS_CACHE_TTL);
    this.logger.log(`[Cache Saved] ${text.substring(0, 30)}... → Redis + FS`);

    return filePath;
  }
}
