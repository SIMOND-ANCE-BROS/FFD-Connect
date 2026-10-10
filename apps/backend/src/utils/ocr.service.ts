import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import axios from "axios";
import * as fs from "fs";

import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { withTimeout } from "./timeout.utils";

/** Décrit la source de l'image pour les logs (mode mock) sans exposer le contenu. */
function describe(image: string | Buffer): string {
  return Buffer.isBuffer(image) ? `buffer, ${image.length} bytes` : image;
}

const AZURE_COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default";
// Azure AI Vision — Image Analysis 4.0, fonctionnalité "read" (OCR texte brut).
const VISION_ANALYZE_PATH =
  "/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read";

/**
 * OCR via Azure AI Vision (Read), authentifié par managed identity (aucune clé
 * de service téléchargée). On récupère le TEXTE BRUT de l'image puis on le parse
 * par regex (même logique métier qu'avant, indépendante du fournisseur OCR).
 * Si `AZURE_VISION_ENDPOINT` n'est pas défini → mode MOCK (dev/tests).
 */
@Injectable()
export class OcrService implements OnModuleInit {
  private readonly logger = new Logger(OcrService.name);
  private endpoint?: string;
  private credential?: TokenCredential;

  constructor(
    private configService: ConfigService,
    private circuitBreakerService: CircuitBreakerService,
  ) {}

  onModuleInit() {
    this.endpoint = this.configService
      .get<string>("AZURE_VISION_ENDPOINT")
      ?.replace(/\/+$/, "");
    if (this.endpoint) {
      // DefaultAzureCredential : managed identity en prod, `az login` en local.
      this.credential = new DefaultAzureCredential();
      this.logger.log("Azure Vision OCR initialized (managed identity)");
    } else {
      this.logger.warn(
        "AZURE_VISION_ENDPOINT not set. OCR will run in MOCK mode.",
      );
    }
  }

  /**
   * Seam testable : image (chemin ou buffer) → texte brut détecté.
   * Appelle Azure Vision Read en REST avec un token managed identity.
   * Les tests mockent cette méthode pour piloter le texte sans réseau.
   */
  private async detectText(image: string | Buffer): Promise<string> {
    const bytes = Buffer.isBuffer(image)
      ? image
      : await fs.promises.readFile(image);
    const token = await this.credential!.getToken(AZURE_COGNITIVE_SCOPE);
    if (!token) throw new Error("Failed to acquire Azure AD token for Vision");

    const res = await axios.post<{
      readResult?: { blocks?: { lines?: { text?: string }[] }[] };
    }>(`${this.endpoint}${VISION_ANALYZE_PATH}`, bytes, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/octet-stream",
      },
      maxBodyLength: Infinity,
    });

    return (res.data.readResult?.blocks ?? [])
      .flatMap((b) => b.lines ?? [])
      .map((l) => l.text ?? "")
      .join("\n");
  }

  async extractLicenseInfo(
    image: string | Buffer,
  ): Promise<{ licenseNumber?: string; name?: string; expiryDate?: string }> {
    if (!this.endpoint) {
      this.logger.log(
        `[MOCK] OCR extracting license info (${describe(image)})`,
      );
      return {
        licenseNumber: "12345678",
        name: "Jean Dupont",
        expiryDate: "2026-12-31",
      };
    }

    try {
      const fullText = await this.circuitBreakerService.fire(
        "azure-vision",
        () =>
          withTimeout(this.detectText(image), 15_000, "Vision.read (license)"),
      );
      if (!fullText) {
        return {};
      }

      // Never log the extracted text: it carries identity and licence data
      // (GDPR, #140). Only non-identifying diagnostics.
      const parsed = this.parseText(fullText);
      this.logger.log(
        `OCR license: ${fullText.length} chars, licenseNumber=${Boolean(parsed.licenseNumber)}, expiryDate=${Boolean(parsed.expiryDate)}`,
      );
      return parsed;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const errorMessage =
        error instanceof Error ? error.stack : "Unknown error";
      this.logger.error("OCR failed", errorMessage);
      return {};
    }
  }

  private parseText(text: string): {
    licenseNumber?: string;
    name?: string;
    expiryDate?: string;
  } {
    // Basic regex-based parsing for demo/MVP
    const licenseMatch = text.match(/Licence\s*(?:N°)?[:\s]*(\d+)/i);
    const dateMatch = text.match(
      /valable\s*jusqu'au[:\s]*(\d{2}\/\d{2}\/\d{4})/i,
    );

    return {
      licenseNumber: licenseMatch ? licenseMatch[1] : undefined,
      expiryDate: dateMatch ? this.formatDate(dateMatch[1]) : undefined,
    };
  }

  private formatDate(frenchDate: string): string {
    const [day, month, year] = frenchDate.split("/");
    return `${year}-${month}-${day}`;
  }

  /**
   * Extrait les informations d'un certificat médical (apte à la pratique, date, médecin).
   * Utilisé pour le renouvellement de licence (document obligatoire).
   */
  async extractMedicalCertificateInfo(image: string | Buffer): Promise<{
    isApte?: boolean;
    date?: string;
    doctorName?: string;
  }> {
    if (!this.endpoint) {
      this.logger.log(`[MOCK] OCR medical certificate (${describe(image)})`);
      return {
        isApte: true,
        date: new Date().toISOString().slice(0, 10),
        doctorName: "Dr. Mock",
      };
    }

    try {
      const fullText = await this.circuitBreakerService.fire(
        "azure-vision",
        () =>
          withTimeout(this.detectText(image), 15_000, "Vision.read (medical)"),
      );
      if (!fullText) {
        return {};
      }
      // Never log the extracted text: a medical certificate is health data
      // (GDPR art. 9, #140) and logs escape the certificate purge. Only
      // non-identifying diagnostics.
      const parsed = this.parseMedicalCertificateText(fullText);
      this.logger.log(
        `OCR medical: ${fullText.length} chars, isApteRead=${parsed.isApte !== undefined}, date=${Boolean(parsed.date)}, doctorName=${Boolean(parsed.doctorName)}`,
      );
      return parsed;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const errorMessage =
        error instanceof Error ? error.stack : "Unknown error";
      this.logger.error("OCR medical certificate failed", errorMessage);
      return {};
    }
  }

  private parseMedicalCertificateText(text: string): {
    isApte?: boolean;
    date?: string;
    doctorName?: string;
  } {
    const normalized = text.replace(/\s+/g, " ").toLowerCase();

    // "apte" ou "apte à la pratique" ou "ne présente pas de contre-indication"
    const apteMatch =
      /\bapte\b/.test(normalized) ||
      /ne présente pas de contre-indication/i.test(text) ||
      /pas de contre-indication/i.test(text);
    const inapteMatch =
      /\binapte\b/.test(normalized) || /contre-indication/i.test(normalized);
    const isApte =
      apteMatch && !inapteMatch ? true : inapteMatch ? false : undefined;

    // Date : JJ/MM/AAAA ou "le 15 janvier 2025"
    const dateMatch =
      text.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ??
      text.match(
        /(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})/i,
      );
    let date: string | undefined;
    if (dateMatch) {
      if (typeof dateMatch === "string") {
        const [d, m, y] = dateMatch.split("/");
        date = `${y}-${m}-${d}`;
      } else if (Array.isArray(dateMatch) && dateMatch.length >= 4) {
        const months: Record<string, string> = {
          janvier: "01",
          février: "02",
          fevrier: "02",
          mars: "03",
          avril: "04",
          mai: "05",
          juin: "06",
          juillet: "07",
          août: "08",
          aout: "08",
          septembre: "09",
          octobre: "10",
          novembre: "11",
          décembre: "12",
          decembre: "12",
        };
        const m = months[dateMatch[2].toLowerCase()] || "01";
        date = `${dateMatch[3]}-${m}-${dateMatch[1].padStart(2, "0")}`;
      }
    }

    // Médecin : "Dr. X" ou "Docteur X" ou ligne avec "médecin"
    let doctorName: string | undefined;
    const drMatch = text.match(
      /(?:Dr\.?|Docteur)\s+([A-ZÀ-Ÿ][a-zà-ÿ\-']+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ\-']+)*)/i,
    );
    if (drMatch) doctorName = drMatch[1].trim();

    // No raw text in the result (#224): it would be persisted with the
    // renewal document and returned by the API — health data, GDPR art. 9.
    return { isApte, date, doctorName };
  }
}
