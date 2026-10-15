// Pure logic of the parental consent page (consentement-parental/index.html,
// #61). Kept free of DOM access so it can be unit-tested. The backend is the
// authority: this file only turns its answers into what the page shows.

export type LinkState = 'PENDING' | 'EXPIRED' | 'GRANTED' | 'REVOKED';

export interface LinkView {
  childFirstName: string;
  state: LinkState;
  expiresAt: string;
  grantedAt: string | null;
  revokedAt: string | null;
}

export type ApiOutcome = { networkError: true } | { status: number; body?: unknown };

export type ConsentAction = 'lookup' | 'confirm' | 'revoke';

export function apiUrl(base: string, action: ConsentAction): string {
  return `${base.replace(/\/+$/, '')}/parental-consent/${action}`;
}

/** What the page renders: one panel, its texts, and the actions it offers. */
export interface PageView {
  panel: 'pending' | 'granted' | 'revoked' | 'expired' | 'error';
  title: string;
  lines: string[];
  /** Offer the two agreements and the "J'accepte" button. */
  canConfirm: boolean;
  /** Offer the withdrawal (or refusal) button. */
  canRevoke: boolean;
}

const UNAVAILABLE = 'Serveur indisponible pour le moment. Réessayez dans quelques instants.';
const INVALID =
  'Ce lien est invalide ou a été remplacé par une demande plus récente. Utilisez le lien du dernier e-mail reçu.';

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });
}

function isLinkView(value: unknown): value is LinkView {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.childFirstName === 'string' &&
    typeof record.expiresAt === 'string' &&
    (record.state === 'PENDING' ||
      record.state === 'EXPIRED' ||
      record.state === 'GRANTED' ||
      record.state === 'REVOKED')
  );
}

/** The child's first name as the page prints it (never empty). */
function nameOf(link: LinkView): string {
  return link.childFirstName.trim() || 'votre enfant';
}

export function viewForLink(link: LinkView): PageView {
  const name = nameOf(link);
  switch (link.state) {
    case 'PENDING':
      return {
        panel: 'pending',
        title: `Accord pour le compte de ${name}`,
        lines: [
          `${name} a créé un compte FFD Connect et vous a désigné comme représentant légal. Tant que vous n'avez pas répondu, son compte reste limité.`,
          `Votre accord permet le traitement de ses données de licencié (identité, licence, compétitions) et, s'il en dépose un, de son certificat médical, vérifié par l'éditeur de l'application.`,
          `Vous pourrez retirer votre accord à tout moment avec ce même lien : le compte sera de nouveau limité et ses certificats médicaux supprimés.`,
          `Ce lien est valable jusqu'au ${formatDate(link.expiresAt)}.`,
        ],
        canConfirm: true,
        canRevoke: true,
      };
    case 'GRANTED':
      return {
        panel: 'granted',
        title: 'Accord enregistré',
        lines: [
          `Vous avez donné votre accord pour le compte de ${name} le ${formatDate(link.grantedAt)}.`,
          'Vous pouvez le retirer à tout moment depuis cette page : le compte sera de nouveau limité et ses certificats médicaux supprimés.',
        ],
        canConfirm: false,
        canRevoke: true,
      };
    case 'REVOKED':
      return {
        panel: 'revoked',
        title: 'Accord retiré',
        lines: [
          link.revokedAt
            ? `Votre accord pour le compte de ${name} a été retiré le ${formatDate(link.revokedAt)}.`
            : `Votre accord pour le compte de ${name} a été retiré.`,
          "Son compte est limité. Pour donner de nouveau votre accord, il doit vous renvoyer une demande depuis l'application.",
        ],
        canConfirm: false,
        canRevoke: false,
      };
    case 'EXPIRED':
      return {
        panel: 'expired',
        title: 'Lien expiré',
        lines: [
          `Ce lien a expiré le ${formatDate(link.expiresAt)}.`,
          `${name} peut vous renvoyer une demande depuis l'application (Profil → Accord parental).`,
        ],
        canConfirm: false,
        canRevoke: true,
      };
  }
}

function errorView(lines: string[]): PageView {
  return { panel: 'error', title: 'Accord parental', lines, canConfirm: false, canRevoke: false };
}

function messagesOf(body: unknown): string[] {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const message = record.message;
  if (typeof message === 'string' && message) return [message];
  if (Array.isArray(message)) {
    const list = message.filter((m): m is string => typeof m === 'string' && m.length > 0);
    if (list.length > 0) return list;
  }
  return [INVALID];
}

/** Any answer of the API (lookup, confirm, revoke) turned into a page view. */
export function describeOutcome(outcome: ApiOutcome): PageView {
  if ('networkError' in outcome) return errorView([UNAVAILABLE]);
  const { status, body } = outcome;
  if (status >= 200 && status < 300) {
    return isLinkView(body) ? viewForLink(body) : errorView([UNAVAILABLE]);
  }
  if (status === 400) return errorView(messagesOf(body));
  if (status === 429) return errorView(['Trop de tentatives. Réessayez dans quelques minutes.']);
  return errorView([UNAVAILABLE]);
}

/** Message of an incomplete link (no token). */
export const MISSING_TOKEN =
  "Lien incomplet. Ouvrez le lien reçu par e-mail ; s'il ne fonctionne pas, copiez-le en entier dans la barre d'adresse.";
