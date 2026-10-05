/**
 * Exceptions datées pour la porte d'audit high/critical.
 *
 * Pourquoi ce fichier existe: un avis sans version corrigée publiée rend la
 * porte INSATISFIABLE. Une porte qui ne peut pas passer au vert cesse d'informer
 * — l'échec devient le fond sonore, et la vraie régression du mois prochain s'y
 * noie. Le 2026-08-29, `image-size` (2 avis high, aucun correctif amont) rendait
 * `Nightly Audit` rouge 5 fois sur 5 depuis sa création.
 *
 * Contrat, volontairement étroit:
 *
 * 1. Une exception coupe la PORTE, jamais la DÉTECTION. L'avis reste listé dans
 *    DEPENDENCY_AUDIT.md, dans sa propre section. On ne perd aucune information.
 * 2. Toute exception PÉRIME. Pas de date = fichier rejeté. Date dépassée =
 *    l'avis redevient bloquant, et le message dit laquelle a expiré.
 * 3. Une exception qui ne correspond à AUCUN avis du scan est signalée comme
 *    orpheline. Un garde-fou qui ne garde plus rien doit se voir: soit l'avis a
 *    été corrigé et la ligne est à supprimer, soit son `id` est faux et
 *    l'exception ne protège pas ce qu'on croit.
 * 4. Fichier illisible ou entrée incomplète = ERREUR, jamais un silence. Le
 *    reste du script est fail-closed, celui-ci aussi.
 */

import * as fs from 'fs';
import * as path from 'path';

export const EXCEPTIONS_FILE = 'audit-exceptions.json';

/** Durée de vie maximale d'une exception. Au-delà, ce n'est plus une exception,
 *  c'est une décision de ne pas corriger — elle doit être prise explicitement. */
export const MAX_LIFETIME_DAYS = 90;

export interface AuditException {
  /** Identifiant d'avis, tel qu'osv-scanner le rapporte (ex. GHSA-xxxx-xxxx-xxxx). */
  id: string;
  /** Paquet visé. Sert de garde-fou: un `id` correct sur le mauvais paquet ne suppresse rien. */
  package: string;
  /** Date d'expiration, ISO `YYYY-MM-DD`. Obligatoire. */
  expires: string;
  /** Pourquoi cet avis ne peut pas être corrigé aujourd'hui. Obligatoire, non vide. */
  reason: string;
}

interface ExceptionsFile {
  exceptions?: unknown;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): never {
  throw new Error(`${EXCEPTIONS_FILE}: ${message}`);
}

/** Parse une date ISO en UTC minuit. Renvoie NaN si la date n'existe pas (2026-02-30). */
function parseIsoDate(value: string): number {
  if (!ISO_DATE.test(value)) return Number.NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return Number.NaN;
  // Date.parse accepte 2026-02-30 sur certains moteurs en le repliant sur mars.
  // On vérifie que l'aller-retour redonne la même chaîne.
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : Number.NaN;
}

/**
 * Lit et valide le fichier d'exceptions. Absent = aucune exception (cas normal).
 * Présent mais invalide = erreur: on ne devine pas ce que l'auteur voulait dire.
 */
export function readExceptions(cwd: string = process.cwd()): AuditException[] {
  const filePath = path.join(cwd, EXCEPTIONS_FILE);
  if (!fs.existsSync(filePath)) return [];

  let parsed: ExceptionsFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ExceptionsFile;
  } catch (error) {
    fail(
      `JSON illisible (${(error as Error).message}). Refus d'auditer avec un fichier d'exceptions douteux.`,
    );
  }

  const raw = parsed.exceptions;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail('la clé "exceptions" doit être un tableau.');

  return raw.map((entry, index) => {
    const where = `exceptions[${index}]`;
    if (typeof entry !== 'object' || entry === null) fail(`${where} n'est pas un objet.`);
    const e = entry as Record<string, unknown>;

    for (const field of ['id', 'package', 'expires', 'reason'] as const) {
      if (typeof e[field] !== 'string' || (e[field] as string).trim() === '') {
        fail(`${where}.${field} est obligatoire et doit être une chaîne non vide.`);
      }
    }

    const expires = (e.expires as string).trim();
    if (Number.isNaN(parseIsoDate(expires))) {
      fail(`${where}.expires ("${expires}") n'est pas une date ISO valide au format YYYY-MM-DD.`);
    }

    return {
      id: (e.id as string).trim(),
      package: (e.package as string).trim(),
      expires,
      reason: (e.reason as string).trim(),
    };
  });
}

/** Vrai si l'exception est encore valable à l'instant `now`. */
export function isActive(exception: AuditException, now: Date): boolean {
  const expiresMs = parseIsoDate(exception.expires);
  // Valable jusqu'à la FIN du jour d'expiration.
  return now.getTime() < expiresMs + 24 * 60 * 60 * 1000;
}

/** Jours restants (négatif si expirée). Sert au message d'avertissement. */
export function daysUntilExpiry(exception: AuditException, now: Date): number {
  const expiresMs = parseIsoDate(exception.expires);
  return Math.floor((expiresMs + 24 * 60 * 60 * 1000 - now.getTime()) / (24 * 60 * 60 * 1000));
}

export interface MatchableVulnerability {
  name: string;
  id: string;
  severity: string;
}

export interface PartitionResult<T extends MatchableVulnerability> {
  /** Avis high/critical encore bloquants: la porte échoue s'il en reste. */
  blocking: T[];
  /** Avis high/critical couverts par une exception active. Détectés, non bloquants. */
  suppressed: Array<{ vulnerability: T; exception: AuditException }>;
  /** Exceptions dont la date est passée: leur avis est REDEVENU bloquant. */
  expired: AuditException[];
  /** Exceptions ne correspondant à aucun avis du scan. */
  orphans: AuditException[];
  /** Exceptions actives qui expirent dans moins de 14 jours. */
  expiringSoon: AuditException[];
}

function matches(exception: AuditException, vuln: MatchableVulnerability): boolean {
  return exception.id === vuln.id && exception.package === vuln.name;
}

/**
 * Répartit les avis high/critical entre bloquants et supprimés, et qualifie
 * l'état de chaque exception. Fonction pure: `now` est injecté, rien n'est lu
 * sur le disque — c'est ce qui la rend testable.
 */
export function partitionVulnerabilities<T extends MatchableVulnerability>(
  vulnerabilities: T[],
  exceptions: AuditException[],
  now: Date,
): PartitionResult<T> {
  const highCritical = vulnerabilities.filter(
    (v) => v.severity === 'high' || v.severity === 'critical',
  );

  const blocking: T[] = [];
  const suppressed: Array<{ vulnerability: T; exception: AuditException }> = [];

  for (const vuln of highCritical) {
    const active = exceptions.find((e) => matches(e, vuln) && isActive(e, now));
    if (active) suppressed.push({ vulnerability: vuln, exception: active });
    else blocking.push(vuln);
  }

  // Une exception expirée n'est signalée que si son avis est TOUJOURS présent:
  // sinon elle est simplement orpheline, et c'est ce qu'on veut dire.
  const stillPresent = (e: AuditException) => highCritical.some((v) => matches(e, v));

  return {
    blocking,
    suppressed,
    expired: exceptions.filter((e) => !isActive(e, now) && stillPresent(e)),
    orphans: exceptions.filter((e) => !stillPresent(e)),
    expiringSoon: exceptions.filter(
      (e) => isActive(e, now) && stillPresent(e) && daysUntilExpiry(e, now) <= 14,
    ),
  };
}
