import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { withTimeout } from "../utils/timeout.utils";
import { PARENTAL_CONSENT_CONFIRMATION_TTL_DAYS } from "./parental-consent.policy";

/** Upper bound of one Resend call made through the circuit breaker. */
export const PARENTAL_CONSENT_EMAIL_TIMEOUT_MS = 8_000;

/** Path of the landing page that consumes the link (apps/landing). */
export const PARENTAL_CONSENT_PAGE_PATH = "/consentement-parental/";

/**
 * E-mail to a minor's legal representative (#61).
 *
 * Its own service rather than a method of `auth/email.service.ts`, which PR
 * #609 rewrites: same Resend configuration, same `email` circuit breaker, same
 * timeout. Throws on failure; the caller degrades (the request is withdrawn
 * and the minor asked to retry).
 */
@Injectable()
export class ParentalConsentEmailService {
  private readonly logger = new Logger(ParentalConsentEmailService.name);
  private readonly resend: Resend | null;
  private readonly fromEmail: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly breaker: CircuitBreakerService,
  ) {
    const apiKey = this.configService.get<string>("RESEND_API_KEY");
    this.fromEmail =
      this.configService.get<string>("RESEND_FROM_EMAIL") ??
      "onboarding@resend.dev";
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  /** Link of the parent's page. The token goes in the query string only. */
  consentUrl(token: string): string {
    const base = (
      this.configService.get<string>("FRONTEND_URL") ?? "http://localhost:3000"
    ).replace(/\/+$/, "");
    return `${base}${PARENTAL_CONSENT_PAGE_PATH}?token=${encodeURIComponent(token)}`;
  }

  async sendConsentRequest(
    parentEmail: string,
    childFirstName: string,
    token: string,
  ): Promise<void> {
    // Without Resend, only log: never the link, the token nor the address.
    if (!this.resend) {
      this.logger.log(
        "Parental consent e-mail not sent (no Resend config, link not logged)",
      );
      return;
    }
    const resend = this.resend;
    const { error } = await this.breaker.fire("email", () =>
      withTimeout(
        resend.emails.send({
          from: this.fromEmail,
          to: parentEmail,
          subject: "Votre accord pour le compte FFD Connect de votre enfant",
          html: parentalConsentEmailTemplate(
            this.consentUrl(token),
            childFirstName,
          ),
        }),
        PARENTAL_CONSENT_EMAIL_TIMEOUT_MS,
        "resend:parental-consent",
      ),
    );
    if (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }
}

/** Strips the characters that could break out of the HTML text context. */
function htmlSafe(text: string): string {
  return text.replace(/[<>&"']/g, "");
}

export function parentalConsentEmailTemplate(
  url: string,
  childFirstName: string,
): string {
  const name = htmlSafe(childFirstName) || "Votre enfant";
  const safeUrl = htmlSafe(url);
  return `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>Accord parental — FFD Connect</title></head>
        <body style="font-family: Arial, sans-serif; color: #222; max-width: 560px; margin: auto;">
          <p>Bonjour,</p>
          <p>${name} vient de créer un compte sur FFD Connect, l'application des licenciés de danse sportive, et a indiqué votre adresse comme celle d'un représentant légal.</p>
          <p>Comme ${name} est mineur(e), son compte reste limité tant que vous n'avez pas donné votre accord : en particulier, aucun certificat médical ne peut être déposé.</p>
          <p><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none;">Voir la demande et donner mon accord</a></p>
          <p>Ce lien est valable ${PARENTAL_CONSENT_CONFIRMATION_TTL_DAYS} jours pour donner votre accord. <strong>Conservez cet e-mail :</strong> le même lien vous permettra de retirer votre accord à tout moment.</p>
          <p>Si vous n'êtes pas le représentant légal de ${name}, ou si vous ne connaissez pas cette demande, ignorez simplement cet e-mail : rien ne sera activé sans votre accord.</p>
          <p style="font-size:12px;color:#666;">FFD Connect est un projet indépendant, non affilié à la Fédération Française de Danse. Votre adresse n'est pas conservée en clair : seule une empreinte permettant de vérifier qu'il s'agit bien d'elle est gardée.</p>
        </body>
      </html>`;
}
