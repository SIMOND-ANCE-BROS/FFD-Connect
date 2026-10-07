import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

/**
 * Service d'envoi d'email pour la réinitialisation de mot de passe
 * Utilise Resend comme service d'envoi d'emails transactionnels
 *
 * Configuration requise dans .env:
 * - RESEND_API_KEY: Clé API Resend
 * - RESEND_FROM_EMAIL: Email de l'expéditeur (doit être vérifié dans Resend)
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null = null;
  private readonly fromEmail: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("RESEND_API_KEY");
    this.fromEmail =
      this.configService.get<string>("RESEND_FROM_EMAIL") ??
      "onboarding@resend.dev";

    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log("Resend email service initialized");
    } else {
      this.logger.warn(
        "RESEND_API_KEY not configured or ConfigService missing. Email sending will be logged only.",
      );
    }
  }

  /**
   * Envoie un email de réinitialisation de mot de passe
   *
   * @param email - Email du destinataire
   * @param resetToken - Token de réinitialisation
   * @param resetUrl - URL de réinitialisation (optionnel)
   */
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    resetUrl?: string,
  ): Promise<void> {
    const url =
      resetUrl ??
      `${
        this.configService.get<string>("FRONTEND_URL") ??
        "http://localhost:3000"
      }/reset-password?token=${resetToken}`;

    // Si Resend n'est pas configuré, on log seulement (sans jamais logger le token)
    if (!this.resend) {
      this.logger.log(
        `Password reset email for ${email} (no Resend config, URL not sent)`,
      );
      return;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: "Réinitialisation de votre mot de passe",
        html: this.getPasswordResetEmailTemplate(url),
      });

      if (error) {
        this.logger.error(
          `Failed to send password reset email: ${error.message}`,
        );
        throw new Error(`Failed to send email: ${error.message}`);
      }

      this.logger.log(
        `Password reset email sent successfully to ${email} (ID: ${data.id})`,
      );
    } catch (error) {
      this.logger.error(
        `Error sending password reset email to ${email}:`,
        error,
      );
      throw error;
    }
  }

  /** Invitation of a Club account created from the admin back-office. */
  async sendInvitationEmail(
    email: string,
    token: string,
    firstName: string,
  ): Promise<void> {
    const url = `${
      this.configService.get<string>("FRONTEND_URL") ?? "http://localhost:3000"
    }/reset-password?token=${token}`;

    if (!this.resend) {
      this.logger.log(
        `Invitation email for ${email} (no Resend config, URL not sent)`,
      );
      return;
    }

    const { data, error } = await this.resend.emails.send({
      from: this.fromEmail,
      to: email,
      subject: "Votre accès club FFD Connect",
      html: this.getInvitationEmailTemplate(url, firstName),
    });
    if (error) {
      this.logger.error(`Failed to send invitation email: ${error.message}`);
      throw new Error(`Failed to send email: ${error.message}`);
    }
    this.logger.log(`Invitation email sent to ${email} (ID: ${data.id})`);
  }

  private getInvitationEmailTemplate(url: string, firstName: string): string {
    const safeName = firstName.replace(/[<>&"']/g, "");
    return `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>Votre accès club FFD Connect</title></head>
        <body style="font-family: Arial, sans-serif; color: #222; max-width: 560px; margin: auto;">
          <p>Bonjour ${safeName},</p>
          <p>Un compte club vient d'être créé pour vous sur FFD Connect.</p>
          <p>Pour l'activer, choisissez votre mot de passe :</p>
          <p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none;">Définir mon mot de passe</a></p>
          <p>Ce lien est valable 7 jours et ne peut servir qu'une fois.</p>
          <p>Si vous n'attendiez pas cet email, ignorez-le.</p>
        </body>
      </html>`;
  }

  /**
   * Template HTML pour l'email de réinitialisation
   * @private
   */
  private getPasswordResetEmailTemplate(resetUrl: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Réinitialisation de mot de passe</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f5f5f5;
            }
            .container {
              background-color: #ffffff;
              border-radius: 8px;
              padding: 30px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 {
              color: #2c3e50;
              margin-top: 0;
            }
            .button {
              display: inline-block;
              padding: 12px 24px;
              background-color: #007bff;
              color: #ffffff;
              text-decoration: none;
              border-radius: 4px;
              margin: 20px 0;
            }
            .button:hover {
              background-color: #0056b3;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #eee;
              font-size: 12px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Réinitialisation de votre mot de passe</h1>
            <p>Bonjour,</p>
            <p>Vous avez demandé à réinitialiser votre mot de passe pour votre compte FFD Connect.</p>
            <p>Cliquez sur le bouton ci-dessous pour réinitialiser votre mot de passe :</p>
            <a href="${resetUrl}" class="button">Réinitialiser mon mot de passe</a>
            <p>Ou copiez et collez ce lien dans votre navigateur :</p>
            <p style="word-break: break-all; color: #007bff;">${resetUrl}</p>
            <p><strong>Ce lien expire dans 1 heure.</strong></p>
            <p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. Votre mot de passe ne sera pas modifié.</p>
            <div class="footer">
              <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
              <p>&copy; ${new Date().getFullYear()} FFD Connect - Tous droits réservés</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}
