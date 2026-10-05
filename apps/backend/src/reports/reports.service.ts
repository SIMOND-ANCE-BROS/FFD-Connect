import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { UploadedFile } from "../utils/file-validation.util";

import { CreateReportDto } from "./dto/create-report.dto";

import {
  GitHubIssueResponse,
  GitHubUploadResponse,
} from "./interfaces/github.interface";

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly githubToken: string | undefined;
  private readonly githubOwner: string | undefined;
  private readonly githubRepo: string | undefined;

  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.githubToken = this.configService.get<string>("GITHUB_TOKEN");
    this.githubOwner = this.configService.get<string>("GITHUB_OWNER");
    this.githubRepo = this.configService.get<string>("GITHUB_REPO");
  }

  /**
   * Crée un nouveau rapport de bug ou de fonctionnalité
   *
   * Cette méthode enregistre un rapport dans la base de données et crée automatiquement
   * une issue GitHub correspondante. Si un fichier (screenshot) est fourni, il sera
   * uploadé sur GitHub et inclus dans l'issue.
   *
   * @param data - Données du rapport (type, titre, description, etc.)
   * @param file - Fichier optionnel (screenshot) à associer au rapport
   * @returns Rapport créé dans la base de données
   *
   * @example
   * ```typescript
   * const report = await reportsService.create({
   *   type: 'BUG',
   *   title: 'Erreur lors de la connexion',
   *   description: 'L\'application crash au login',
   *   userId: 'user-123',
   *   stackTrace: 'Error: ...',
   * }, screenshotFile);
   * ```
   */
  async create(data: CreateReportDto, file?: UploadedFile) {
    this.logger.log(`New ${data.type} report received: ${data.title}`);

    // 1. Save to Database
    const report = await this.prisma.bugReport.create({
      data: {
        userId: data.userId,
        message: `[${data.type}][${data.module ?? "General"}] ${data.title}\n\n${data.description}\n\nSteps:\n${data.steps ?? "N/A"}`,
        stackTrace: data.stackTrace,
        deviceInfo: data.deviceInfo,
      },
    });

    // 2. Create GitHub Issue
    this.createGitHubIssue(data, file).catch((err) =>
      this.logger.error(
        "Failed to create GitHub issue",
        err instanceof Error ? err.stack : undefined,
      ),
    );

    return report;
  }

  /**
   * Crée une issue GitHub à partir d'un rapport
   *
   * Cette méthode privée crée automatiquement une issue GitHub correspondant
   * au rapport de bug ou de fonctionnalité. Si un fichier screenshot est fourni,
   * il sera uploadé sur GitHub et inclus dans l'issue.
   *
   * @private
   * @param data - Données du rapport
   * @param file - Fichier screenshot optionnel
   * @returns Promise qui se résout une fois l'issue créée
   */
  private async createGitHubIssue(data: CreateReportDto, file?: UploadedFile) {
    const token = this.githubToken;
    const owner = this.githubOwner;
    const repo = this.githubRepo;

    if (!token || !owner || !repo) {
      this.logger.warn("Missing GitHub env vars. Skipping issue creation.");
      return;
    }

    let imageUrl = "";

    // Upload Image if present
    if (file) {
      try {
        const filename = `reports/${Date.now()}-${file.originalname}`;
        // Convert buffer to base64
        if (!file.buffer) {
          throw new Error("File buffer is empty");
        }
        const content = file.buffer.toString("base64");

        const uploadRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filename}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: `[Auto-Upload] Screenshot for report`,
              content: content,
            }),
          },
        );

        if (uploadRes.ok) {
          const uploadData = (await uploadRes.json()) as GitHubUploadResponse;
          imageUrl = uploadData.content.download_url; // Or html_url, usually download_url renders better
        } else {
          const errorText = await uploadRes.text();
          this.logger.error(`Failed to upload image to GitHub: ${errorText}`);
        }
      } catch (e) {
        this.logger.error(
          "Image upload exception",
          e instanceof Error ? e.stack : undefined,
        );
      }
    }

    let body = "";
    let labels: string[] = [];

    const moduleLabelMap: Record<string, string> = {
      Connexion: "module:auth",
      Licences: "module:profile",
      Musique: "module:player",
      Compétition: "module:competition",
      Thème: "module:ui",
    };

    const severityLabelMap: Record<string, string> = {
      LOW: "priority:low",
      MEDIUM: "priority:medium",
      HIGH: "priority:high",
    };

    if (data.type === "BUG") {
      labels = ["bug", "mobile-report"];
      if (data.module && moduleLabelMap[data.module]) {
        labels.push(moduleLabelMap[data.module]);
      }
      if (data.severity && severityLabelMap[data.severity]) {
        labels.push(severityLabelMap[data.severity]);
      }

      body = `
**Affected Module**
${data.module ?? "Unknown"}

**Severity**
${data.severity ?? "Unknown"}

**App Version**
${data.appVersion ?? "Unknown"}

**Describe the bug**
${data.description}

**To Reproduce**
${data.steps ?? "No steps provided"}

<details>
<summary>✈️ Black Box (Recent Logs)</summary>

\`\`\`
${data.logs ?? "No logs available"}
\`\`\`
</details>

**Screenshots**
${imageUrl ? `![Screenshot](${imageUrl})` : "No screenshot provided"}

**Smartphone:**
 - Device Info: ${data.deviceInfo ?? "Unknown"}
 - User ID: ${data.userId ?? "Anonymous"}

**Stack Trace**
\`\`\`
${data.stackTrace ?? "No stack trace"}
\`\`\`
          `;
    } else {
      // FEATURE type
      labels = ["enhancement", "mobile-report"];
      if (data.module && moduleLabelMap[data.module]) {
        labels.push(moduleLabelMap[data.module]);
      }

      body = `
**Related Module**
${data.module ?? "General"}

**Is your feature request related to a problem? Please describe.**
${data.description}

**Describe the solution you'd like**
(User suggestion via App)
${imageUrl ? `\n**Attachment**\n![Screenshot](${imageUrl})` : ""}

**Additional context**
User ID: ${data.userId ?? "Anonymous"}
Device: ${data.deviceInfo}
          `;
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `[${data.type}] ${data.title}`,
          body: body,
          labels: labels,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API Error ${response.status}: ${errorText}`);
    }

    const issue = (await response.json()) as GitHubIssueResponse;
    this.logger.log(`GitHub issue created: ${issue.html_url}`);
  }
}
