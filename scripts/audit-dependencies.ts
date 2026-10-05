#!/usr/bin/env tsx
/**
 * Script d'audit des dépendances deprecated
 *
 * Ce script analyse les dépendances du projet pour identifier:
 * - Les packages deprecated
 * - Les packages avec des vulnérabilités connues
 * - Les packages obsolètes qui nécessitent une mise à jour
 *
 * Source de sécurité: osv-scanner (Google) lu contre la base OSV à partir de
 * pnpm-lock.yaml. Remplace `pnpm audit`, cassé sur pnpm 10.x/11.x depuis que npm
 * a retiré ses anciens endpoints d'audit (HTTP 410).
 */

import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  EXCEPTIONS_FILE,
  daysUntilExpiry,
  partitionVulnerabilities,
  readExceptions,
  type AuditException,
  type PartitionResult,
} from './audit-exceptions';

const OSV_LOCKFILE = 'pnpm-lock.yaml';

type Severity = 'critical' | 'high' | 'moderate' | 'low';

interface DeprecationInfo {
  package: string;
  version: string;
  reason?: string;
  alternative?: string;
}

interface Vulnerability {
  name: string;
  version: string;
  severity: Severity;
  title: string;
  id: string;
}

interface AuditResult {
  deprecated: DeprecationInfo[];
  vulnerabilities: Vulnerability[];
  outdated: Array<{
    package: string;
    current: string;
    wanted: string;
    latest: string;
  }>;
}

// --- Structure JSON d'osv-scanner (`--format json`) ---------------------------
// results[].packages[] liste UNIQUEMENT les packages vulnérables. La sévérité se
// lit à deux endroits: le label d'avis (database_specific.severity, ex "MODERATE")
// et le score CVSS agrégé (groups[].max_severity, ex "7.5").
interface OsvGroup {
  ids?: string[];
  max_severity?: string;
}

interface OsvVulnerabilityEntry {
  id?: string;
  summary?: string;
  database_specific?: { severity?: string };
}

interface OsvPackageResult {
  package?: { name?: string; version?: string; ecosystem?: string };
  groups?: OsvGroup[];
  vulnerabilities?: OsvVulnerabilityEntry[];
}

interface OsvOutput {
  results?: Array<{ packages?: OsvPackageResult[] }>;
}

function readPackageJson(dir: string): {
  name: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} | null {
  const packagePath = path.join(dir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return null;
  }
  const content = fs.readFileSync(packagePath, 'utf-8');
  return JSON.parse(content);
}

function checkDeprecatedPackages(): DeprecationInfo[] {
  const deprecated: DeprecationInfo[] = [];

  // Packages connus comme deprecated dans le projet
  const knownDeprecated = [
    {
      package: 'glob',
      reason: 'Old versions contain security vulnerabilities',
      alternative: 'Update to latest version',
    },
    {
      package: 'rimraf',
      reason: 'Versions prior to v4 are no longer supported',
      alternative: 'Update to rimraf@^4.0.0',
    },
  ];

  // Vérifier dans pnpm-lock.yaml pour les packages deprecated
  const lockPath = path.join(process.cwd(), 'pnpm-lock.yaml');
  if (fs.existsSync(lockPath)) {
    const lockContent = fs.readFileSync(lockPath, 'utf-8');

    // Rechercher les mentions "deprecated" dans le lockfile
    const deprecatedMatches = lockContent.matchAll(/deprecated:\s*(.+)/g);
    for (const match of deprecatedMatches) {
      const deprecationNote = match[1].trim();
      // Extraire le nom du package depuis le contexte
      const lines = lockContent.split('\n');
      const matchIndex = lockContent.indexOf(match[0]);
      const lineIndex = lockContent.substring(0, matchIndex).split('\n').length - 1;

      // Chercher le nom du package quelques lignes avant
      for (let i = Math.max(0, lineIndex - 10); i < lineIndex; i++) {
        const line = lines[i];
        const pkgMatch = line.match(/^\s+([^@\s]+(?:@[^:\s]+)?):/);
        if (pkgMatch) {
          deprecated.push({
            package: pkgMatch[1],
            version: 'unknown',
            reason: deprecationNote,
          });
          break;
        }
      }
    }
  }

  return deprecated;
}

// CVSS base score → bande de sévérité (fallback quand aucun label d'avis n'existe).
function cvssScoreToSeverity(score: number): Severity {
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'moderate';
  return 'low';
}

// Normalise un label de sévérité OSV/GHSA vers notre échelle à 4 niveaux.
function normaliseSeverityLabel(label: string | undefined): Severity | null {
  switch ((label ?? '').trim().toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MODERATE':
    case 'MEDIUM':
      return 'moderate';
    case 'LOW':
      return 'low';
    default:
      return null;
  }
}

// Détermine la sévérité d'une vulnérabilité en préservant EXACTEMENT la sémantique
// de `npm/pnpm audit` (ce que ce gate remplace).
function severityForVulnerability(vuln: OsvVulnerabilityEntry, groups: OsvGroup[]): Severity {
  // 1. Priorité au label de l'avis (GHSA/OSV database severity). C'est ce que
  //    reportait `pnpm audit`, donc on garde la parité npm-audit. Exemple concret:
  //    uuid GHSA-w5hq-g745-h8pq est labellisé MODERATE alors que son score CVSS
  //    vaut 7.5 — un mapping numérique naïf l'escaladerait à tort en "high" et
  //    casserait le gate sur un medium volontairement toléré.
  const labelled = normaliseSeverityLabel(vuln.database_specific?.severity);
  if (labelled) return labelled;

  // 2. Fallback: mapper le plus haut score CVSS qu'OSV a agrégé pour cet avis.
  const group = groups.find((g) => (g.ids ?? []).includes(vuln.id ?? ''));
  const score = Number.parseFloat(group?.max_severity ?? '');
  if (Number.isFinite(score)) return cvssScoreToSeverity(score);

  // 3. Ni label ni score: avis inclassable. On échoue fermé — traité comme "high"
  //    pour qu'il remonte au lieu d'être silencieusement ignoré par le gate.
  console.warn(
    `⚠️  Sévérité inconnue pour ${vuln.id ?? 'un avis sans id'} — traitée comme "high" (fail-closed).`,
  );
  return 'high';
}

// Lance osv-scanner et convertit sa sortie en Vulnerability[].
//
// FAIL-CLOSED: osv-scanner sort 0 (scanné, aucune vuln) ou 1 (scanné, vulns
// trouvées). Ces deux codes = scan RÉUSSI. Tout autre code (127 erreur générale,
// 128 aucun package parsé, binaire absent, JSON illisible…) signifie que l'audit
// n'a PAS eu lieu: on lève une erreur (exit 1 en amont), on ne renvoie JAMAIS un
// tableau vide qui se ferait passer pour "0 vulnérabilité".
function runOsvScanner(): Vulnerability[] {
  const lockfilePath = path.join(process.cwd(), OSV_LOCKFILE);
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(
      `Lockfile introuvable (${lockfilePath}). osv-scanner ne peut pas auditer sans ${OSV_LOCKFILE}.`,
    );
  }

  let stdout = '';
  let exitCode = 0;
  try {
    // execFileSync (argv array, no shell) — pas d'interpolation shell possible.
    stdout = execFileSync('osv-scanner', ['--format', 'json', `--lockfile=${OSV_LOCKFILE}`], {
      encoding: 'utf-8',
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const err = error as { status?: number | null; stdout?: Buffer | string; message?: string };
    exitCode = typeof err.status === 'number' ? err.status : NaN;
    stdout = err.stdout ? err.stdout.toString() : '';
    if (exitCode !== 1) {
      throw new Error(
        `osv-scanner n'a pas pu réaliser l'audit (exit ${String(exitCode)}: ${err.message ?? 'erreur inconnue'}). ` +
          `C'est une erreur d'exécution du scanner, PAS un résultat "0 vulnérabilité". ` +
          `Vérifier qu'osv-scanner est installé et que ${OSV_LOCKFILE} est lisible.`,
      );
    }
  }

  // Un scan qui a abouti (exit 0/1) doit produire du JSON. Une sortie vide n'est
  // acceptable que sur un exit 0 (rien à signaler); sinon = erreur d'infra.
  const trimmed = stdout.trim();
  if (trimmed === '') {
    if (exitCode === 0) return [];
    throw new Error(
      `osv-scanner a signalé des vulnérabilités (exit ${String(exitCode)}) mais n'a produit aucune sortie JSON — audit non exploitable.`,
    );
  }

  let parsed: OsvOutput;
  try {
    parsed = JSON.parse(trimmed) as OsvOutput;
  } catch {
    throw new Error(
      `Sortie osv-scanner illisible (JSON invalide, exit ${String(exitCode)}) — audit non réalisé. ` +
        `Échec volontaire pour éviter un faux "0 vulnérabilité".`,
    );
  }

  const vulnerabilities: Vulnerability[] = [];
  for (const result of parsed.results ?? []) {
    for (const pkg of result.packages ?? []) {
      const name = pkg.package?.name ?? 'unknown';
      const version = pkg.package?.version ?? 'unknown';
      const groups = pkg.groups ?? [];
      for (const vuln of pkg.vulnerabilities ?? []) {
        vulnerabilities.push({
          name,
          version,
          severity: severityForVulnerability(vuln, groups),
          title: vuln.summary ?? vuln.id ?? 'Vulnérabilité sans description',
          id: vuln.id ?? 'unknown',
        });
      }
    }
  }
  return vulnerabilities;
}

function checkOutdatedPackages(): Array<{
  package: string;
  current: string;
  wanted: string;
  latest: string;
}> {
  try {
    const output = execSync('pnpm outdated --json', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      stdio: 'pipe',
    });
    const outdated = JSON.parse(output);
    return Object.entries(outdated).map(([pkg, info]: [string, any]) => ({
      package: pkg,
      current: info.current || 'unknown',
      wanted: info.wanted || 'unknown',
      latest: info.latest || 'unknown',
    }));
  } catch {
    return [];
  }
}

function generateReport(result: AuditResult, partition: PartitionResult<Vulnerability>): string {
  let report = '# Audit des Dépendances\n\n';
  report += `Date: ${new Date().toISOString()}\n\n`;

  // Section Deprecated
  report += '## 📦 Packages Deprecated\n\n';
  if (result.deprecated.length === 0) {
    report += '✅ Aucun package deprecated identifié.\n\n';
  } else {
    report += `⚠️ ${result.deprecated.length} package(s) deprecated trouvé(s):\n\n`;
    result.deprecated.forEach((dep) => {
      report += `- **${dep.package}** (${dep.version})\n`;
      if (dep.reason) {
        report += `  - Raison: ${dep.reason}\n`;
      }
      if (dep.alternative) {
        report += `  - Alternative: ${dep.alternative}\n`;
      }
      report += '\n';
    });
  }

  // Section Vulnerabilities
  report += '## 🔒 Vulnérabilités\n\n';
  if (result.vulnerabilities.length === 0) {
    report += '✅ Aucune vulnérabilité connue (osv-scanner / base OSV).\n\n';
  } else {
    const highCritical = result.vulnerabilities.filter(
      (v) => v.severity === 'high' || v.severity === 'critical',
    ).length;
    report += `⚠️ ${result.vulnerabilities.length} vulnérabilité(s) trouvée(s) — dont ${highCritical} high/critical (bloquante(s) pour le gate):\n\n`;
    result.vulnerabilities.slice(0, 20).forEach((vuln) => {
      report += `- **${vuln.name}@${vuln.version}** (${vuln.severity}) — ${vuln.id}\n`;
      if (vuln.title) {
        report += `  - ${vuln.title}\n`;
      }
      report += '\n';
    });
    if (result.vulnerabilities.length > 20) {
      report += `\n... et ${result.vulnerabilities.length - 20} autre(s) vulnérabilité(s).\n\n`;
    }
  }

  // Section Outdated
  report += '## 🔄 Packages Obsolètes\n\n';
  if (result.outdated.length === 0) {
    report += '✅ Tous les packages sont à jour.\n\n';
  } else {
    report += `📋 ${result.outdated.length} package(s) obsolète(s):\n\n`;
    report += '| Package | Version Actuelle | Version Recommandée | Version Latest |\n';
    report += '|---------|------------------|---------------------|----------------|\n';
    result.outdated.slice(0, 30).forEach((pkg) => {
      report += `| ${pkg.package} | ${pkg.current} | ${pkg.wanted} | ${pkg.latest} |\n`;
    });
    if (result.outdated.length > 30) {
      report += `\n... et ${result.outdated.length - 30} autre(s) package(s).\n\n`;
    }
  }

  // Section Exceptions — la porte est relachee ici, donc ca se lit noir sur blanc.
  const { suppressed, expired, orphans, expiringSoon } = partition;
  if (suppressed.length > 0 || expired.length > 0 || orphans.length > 0) {
    report += `## 🕒 Exceptions datées (${EXCEPTIONS_FILE})\n\n`;

    if (suppressed.length > 0) {
      report += `${suppressed.length} avis high/critical non bloquant(s), par exception explicite :\n\n`;
      suppressed.forEach(({ vulnerability, exception }) => {
        report += `- **${vulnerability.name}@${vulnerability.version}** — ${vulnerability.id}\n`;
        report += `  - Expire le ${exception.expires}\n`;
        report += `  - Raison: ${exception.reason}\n\n`;
      });
    }

    if (expiringSoon.length > 0) {
      report += `⏳ ${expiringSoon.length} exception(s) arrivent à échéance :\n\n`;
      expiringSoon.forEach((e: AuditException) => {
        report += `- ${e.package} / ${e.id} — expire le ${e.expires}\n`;
      });
      report += '\n';
    }

    if (expired.length > 0) {
      report += `❌ ${expired.length} exception(s) EXPIRÉE(S) — leur avis est redevenu bloquant :\n\n`;
      expired.forEach((e: AuditException) => {
        report += `- ${e.package} / ${e.id} — expirée le ${e.expires}\n`;
      });
      report += '\n';
    }

    if (orphans.length > 0) {
      report += `🧹 ${orphans.length} exception(s) ne couvrent plus aucun avis de ce scan :\n\n`;
      orphans.forEach((e: AuditException) => {
        report += `- ${e.package} / ${e.id} — corrigé en amont, ou \`id\`/\`package\` erroné. À retirer ou corriger.\n`;
      });
      report += '\n';
    }
  }

  // Recommandations
  report += '## 💡 Recommandations\n\n';
  report += '1. **Mettre à jour les packages deprecated** dès que possible\n';
  report +=
    '2. **Corriger les vulnérabilités high/critical** par mise à jour des dépendances ou `pnpm.overrides` (pnpm-workspace.yaml)\n';
  report += '3. **Mettre à jour les packages obsolètes** progressivement\n';
  report += '4. **Tester après chaque mise à jour** pour éviter les régressions\n';
  report += '5. **Surveiller les dépendances critiques** (NestJS, React, Prisma, etc.)\n\n';

  return report;
}

async function main() {
  console.log('🔍 Audit des dépendances en cours...\n');

  const deprecated = checkDeprecatedPackages();
  console.log(`✓ Vérification des packages deprecated: ${deprecated.length} trouvé(s)`);

  const vulnerabilities = runOsvScanner();
  console.log(
    `✓ Audit de sécurité (osv-scanner): ${vulnerabilities.length} vulnérabilité(s) trouvée(s)`,
  );

  const outdated = checkOutdatedPackages();
  console.log(`✓ Vérification des packages obsolètes: ${outdated.length} trouvé(s)`);

  const result: AuditResult = {
    deprecated,
    vulnerabilities,
    outdated,
  };

  // Les exceptions sont lues APRES le scan: un fichier invalide doit faire
  // echouer l'audit, jamais le rendre vert par accident.
  const exceptions = readExceptions();
  const partition = partitionVulnerabilities(vulnerabilities, exceptions, new Date());
  if (exceptions.length > 0) {
    console.log(
      `✓ Exceptions datées: ${exceptions.length} déclarée(s), ${partition.suppressed.length} appliquée(s)`,
    );
  }

  const report = generateReport(result, partition);

  // Écrire le rapport dans un fichier
  const reportPath = path.join(process.cwd(), 'DEPENDENCY_AUDIT.md');
  fs.writeFileSync(reportPath, report, 'utf-8');

  console.log(`\n📄 Rapport généré: ${reportPath}\n`);
  console.log(report);

  // Une exception orpheline ne bloque pas — elle ne protege plus rien, donc
  // elle ne peut rien casser. Mais elle se voit: sinon la ligne morte reste des
  // mois et on croit couvert un avis qui ne l'est pas.
  partition.orphans.forEach((e: AuditException) => {
    console.warn(
      `⚠️  Exception orpheline: ${e.package} / ${e.id} ne correspond à aucun avis de ce scan. ` +
        `Corrigé en amont (retirer la ligne) ou id/package erroné (l'exception ne protège pas ce qu'on croit).`,
    );
  });

  partition.expiringSoon.forEach((e: AuditException) => {
    console.warn(
      `⏳ Exception bientôt échue: ${e.package} / ${e.id} expire le ${e.expires} ` +
        `(dans ${daysUntilExpiry(e, new Date())} jour(s)) — l'avis redeviendra bloquant.`,
    );
  });

  if (partition.expired.length > 0) {
    const stale = partition.expired
      .map((e: AuditException) => `${e.package} / ${e.id} (échue le ${e.expires})`)
      .join(', ');
    console.error(`\n⏰ Exception(s) expirée(s), leur avis redevient bloquant: ${stale}.`);
  }

  // Exit 1 uniquement pour vulnérabilités high/critical NON couvertes par une
  // exception active (dépréciations et outdated = rapport seulement).
  if (partition.blocking.length > 0) {
    const offenders = partition.blocking
      .map((v) => `${v.name}@${v.version} (${v.severity}, ${v.id})`)
      .join(', ');
    console.error(
      `\n❌ Vulnérabilités high/critical détectées: ${offenders}.\n` +
        `Corriger par mise à jour des dépendances ou pnpm.overrides (pnpm-workspace.yaml).\n` +
        `Si un avis n'a aucun correctif amont, déclarer une exception datée dans ${EXCEPTIONS_FILE}.\n`,
    );
    process.exit(1);
  }

  if (partition.suppressed.length > 0) {
    console.log(
      `\n✅ Porte franchie — ${partition.suppressed.length} avis high/critical couvert(s) par une exception datée. ` +
        `Détail dans DEPENDENCY_AUDIT.md.\n`,
    );
  }
}

main().catch((error) => {
  console.error("❌ Erreur lors de l'audit:", error);
  process.exit(1);
});
