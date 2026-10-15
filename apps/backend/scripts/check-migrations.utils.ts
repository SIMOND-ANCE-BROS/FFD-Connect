/**
 * Pure rules behind `check-migrations.ts` (#494): a PR's Prisma migrations
 * must stay safe for a single-revision deploy with automatic rollback
 * (ADR-0017). The database migrates at container boot, BEFORE the smoke test:
 * after a rollback, the previous image runs against the migrated schema.
 *
 *  1. Existing migrations are immutable: Prisma records a checksum per applied
 *     migration, and an edited file never re-runs where it was applied.
 *  2. New migrations sort after every migration of the base branch, with a
 *     timestamp prefix used by no other migration (two PRs created
 *     `20261015120000_*` the same night, #605 / #628).
 *  3. Destructive SQL (drop, type change, NOT NULL without default, rename)
 *     breaks the previous image: refused unless the file carries
 *     `-- destructive-approved: #<issue>` (docs/exploitation/deploiement-azure.md).
 *  4. Warning only: an enum value added by the PR and already written by code
 *     of the same PR (#269 — ship the enum value first).
 *
 * No I/O here: the CLI feeds git output and file contents in.
 */

export const MIGRATIONS_DIR = "apps/backend/prisma/schema/migrations";

/** Prisma's folder name: 14-digit UTC timestamp, underscore, slug. */
const MIGRATION_NAME = /^(\d{14})_[A-Za-z0-9_]+$/;

/** Files Prisma itself rewrites: never a migration edit. */
const IGNORED_FILES = new Set(["migration_lock.toml"]);

const APPROVAL_MARKER = /--[ \t]*destructive-approved:[ \t]*#(\d+)/i;

export type FindingLevel = "error" | "warning";

export interface Finding {
  level: FindingLevel;
  message: string;
  /** Repository-relative path, for a GitHub annotation. */
  file?: string;
  line?: number;
}

export interface FileChange {
  /** git status letter: A, M, D, T… (renames are disabled by the caller). */
  status: string;
  path: string;
}

export type DestructiveKind =
  | "drop-table"
  | "drop-type"
  | "drop-column"
  | "column-type-change"
  | "not-null-without-default"
  | "rename";

export interface DestructiveStatement {
  kind: DestructiveKind;
  line: number;
  statement: string;
}

const KIND_LABELS: Record<DestructiveKind, string> = {
  "drop-table": "DROP TABLE",
  "drop-type": "DROP TYPE",
  "drop-column": "DROP COLUMN",
  "column-type-change": "ALTER COLUMN ... TYPE",
  "not-null-without-default": "NOT NULL without DEFAULT",
  rename: "RENAME",
};

/** Parses `git diff --name-status --no-renames` output. */
export function parseNameStatus(output: string): FileChange[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status.charAt(0), path: rest.join("\t") };
    });
}

/** Migration folder of a path under MIGRATIONS_DIR, or null. */
export function migrationFolderOf(
  path: string,
  dir: string = MIGRATIONS_DIR,
): string | null {
  const prefix = `${dir}/`;
  if (!path.startsWith(prefix)) return null;
  const parts = path.slice(prefix.length).split("/");
  return parts.length >= 2 ? parts[0] : null;
}

/** Migration folders present in a `git ls-tree --name-only` listing. */
export function migrationFoldersFromListing(listing: string): string[] {
  return listing
    .split("\n")
    .map((entry) => entry.trim().split("/").pop() ?? "")
    .filter((name) => name.length > 0 && !IGNORED_FILES.has(name))
    .sort();
}

/**
 * Splits the PR's changes under the migrations directory: folders it adds,
 * and errors for any touched migration that already exists on the base.
 */
export function classifyMigrationChanges(
  changes: FileChange[],
  baseFolders: string[],
  dir: string = MIGRATIONS_DIR,
): { added: string[]; findings: Finding[] } {
  const base = new Set(baseFolders);
  const added = new Set<string>();
  const findings: Finding[] = [];
  for (const change of changes) {
    const folder = migrationFolderOf(change.path, dir);
    if (folder === null) continue;
    if (base.has(folder)) {
      const verb = change.status === "D" ? "deletes" : "modifies";
      findings.push({
        level: "error",
        file: change.path,
        message:
          `This PR ${verb} ${change.path}, part of the already merged migration ` +
          `${folder}. Applied migrations are immutable (Prisma checksums them and ` +
          `never re-runs them): add a new migration instead.`,
      });
    } else if (change.status !== "D") {
      added.add(folder);
    }
  }
  return { added: [...added].sort(), findings };
}

/** Rule 2: naming, ordering after the base, unique timestamp prefix. */
export function checkOrdering(
  added: string[],
  baseFolders: string[],
  dir: string = MIGRATIONS_DIR,
): Finding[] {
  const findings: Finding[] = [];
  const latestBase = [...baseFolders].sort().pop();
  const timestamps = new Map<string, string[]>();
  for (const name of [...baseFolders, ...added]) {
    const match = MIGRATION_NAME.exec(name);
    if (!match) continue;
    timestamps.set(match[1], [...(timestamps.get(match[1]) ?? []), name]);
  }

  for (const name of added) {
    const file = `${dir}/${name}/migration.sql`;
    const match = MIGRATION_NAME.exec(name);
    if (!match) {
      findings.push({
        level: "error",
        file,
        message: `Migration folder "${name}" does not follow Prisma's <YYYYMMDDHHMMSS>_<name> format.`,
      });
      continue;
    }
    if (latestBase !== undefined && name <= latestBase) {
      findings.push({
        level: "error",
        file,
        message:
          `Migration ${name} sorts before ${latestBase}, the latest migration of ` +
          `the base branch: environments would apply them in different orders. ` +
          `Rename the folder with a timestamp after ${latestBase.slice(0, 14)}.`,
      });
    }
    const sharing = (timestamps.get(match[1]) ?? []).filter((n) => n !== name);
    if (sharing.length > 0) {
      findings.push({
        level: "error",
        file,
        message:
          `Migration ${name} shares its timestamp ${match[1]} with ` +
          `${sharing.join(", ")}: pick a unique timestamp.`,
      });
    }
  }
  return findings;
}

/**
 * Blanks out comments, dollar-quoted bodies and (optionally) string literals,
 * keeping every newline so offsets still map to the original lines.
 */
export function maskSql(sql: string, maskStrings = true): string {
  const out: string[] = [];
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out.push(blank(sql.slice(i, stop)));
      i = stop;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out.push(blank(sql.slice(i, stop)));
      i = stop;
      continue;
    }
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out.push(blank(sql.slice(i, stop)));
      i = stop;
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote && sql[j + 1] === quote) j += 2;
        else if (sql[j] === quote) break;
        else j += 1;
      }
      const stop = Math.min(j + 1, sql.length);
      const literal = sql.slice(i, stop);
      out.push(
        quote === "'" && maskStrings
          ? `'${blank(literal.slice(1, -1))}'`
          : literal,
      );
      i = stop;
      continue;
    }
    out.push(sql[i]);
    i += 1;
  }
  return out.join("");
}

interface Statement {
  text: string;
  line: number;
}

/** Splits masked SQL on `;`, with the 1-based line of each statement. */
function splitStatements(masked: string): Statement[] {
  const statements: Statement[] = [];
  let start = 0;
  for (let i = 0; i <= masked.length; i += 1) {
    if (i < masked.length && masked[i] !== ";") continue;
    const chunk = masked.slice(start, i);
    const lead = chunk.length - chunk.trimStart().length;
    const text = chunk.trim().replace(/\s+/g, " ");
    if (text.length > 0) {
      const line = masked.slice(0, start + lead).split("\n").length;
      statements.push({ text, line });
    }
    start = i + 1;
  }
  return statements;
}

/** Splits on commas outside parentheses and double quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let current = "";
  for (const char of text) {
    if (char === '"') inQuote = !inQuote;
    if (!inQuote && char === "(") depth += 1;
    if (!inQuote && char === ")") depth -= 1;
    if (!inQuote && depth === 0 && char === ",") {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED = String.raw`${IDENT}(?:\.${IDENT})?`;
const ALTER_TABLE = new RegExp(
  String.raw`^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(${QUALIFIED})\s+(.*)$`,
  "is",
);
const ALTER_COLUMN = new RegExp(
  String.raw`^ALTER (?:COLUMN )?(${IDENT}) (.*)$`,
  "is",
);
const ADD_COLUMN = new RegExp(
  String.raw`^ADD (?:COLUMN )?(?:IF NOT EXISTS )?(${IDENT}) (.*)$`,
  "is",
);
const ADD_NON_COLUMN =
  /^ADD (?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b/i;

const normalizeIdent = (ident: string) =>
  ident.startsWith('"')
    ? ident.slice(1, -1).replace(/""/g, '"')
    : ident.toLowerCase();

interface AlterAction {
  table: string;
  action: string;
  statement: Statement;
}

function alterTableActions(statements: Statement[]): AlterAction[] {
  const actions: AlterAction[] = [];
  for (const statement of statements) {
    const match = ALTER_TABLE.exec(statement.text);
    if (!match) continue;
    const table = match[1].split(".").map(normalizeIdent).join(".");
    for (const action of splitTopLevel(match[2])) {
      actions.push({ table, action, statement });
    }
  }
  return actions;
}

/** Rule 3: statements the previous image cannot live with. */
export function findDestructiveStatements(sql: string): DestructiveStatement[] {
  const statements = splitStatements(maskSql(sql));
  const found: DestructiveStatement[] = [];
  const flag = (kind: DestructiveKind, statement: Statement) =>
    found.push({ kind, line: statement.line, statement: statement.text });

  for (const statement of statements) {
    if (/^DROP TABLE\b/i.test(statement.text)) flag("drop-table", statement);
    else if (/^DROP TYPE\b/i.test(statement.text)) flag("drop-type", statement);
    else if (/^ALTER TYPE\b.*\bRENAME\b/i.test(statement.text))
      flag("rename", statement);
  }

  const actions = alterTableActions(statements);
  const defaults = new Set<string>();
  for (const { table, action } of actions) {
    const column = ALTER_COLUMN.exec(action);
    if (column && /^SET DEFAULT\b/i.test(column[2])) {
      defaults.add(`${table}.${normalizeIdent(column[1])}`);
    }
  }

  for (const { table, action, statement } of actions) {
    if (/^DROP (?!CONSTRAINT\b)/i.test(action)) {
      flag("drop-column", statement);
      continue;
    }
    if (/^RENAME (?!CONSTRAINT\b)/i.test(action)) {
      flag("rename", statement);
      continue;
    }
    const altered = ALTER_COLUMN.exec(action);
    if (altered) {
      const change = altered[2];
      if (/^(?:SET DATA )?TYPE\b/i.test(change)) {
        flag("column-type-change", statement);
      } else if (
        /^SET NOT NULL\b/i.test(change) &&
        !defaults.has(`${table}.${normalizeIdent(altered[1])}`)
      ) {
        flag("not-null-without-default", statement);
      }
      continue;
    }
    if (ADD_NON_COLUMN.test(action)) continue;
    const added = ADD_COLUMN.exec(action);
    if (
      added &&
      /\bNOT NULL\b/i.test(added[2]) &&
      !/\b(?:DEFAULT|GENERATED)\b/i.test(added[2])
    ) {
      flag("not-null-without-default", statement);
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Issue number of the `-- destructive-approved: #<n>` marker, or null. */
export function findApprovalMarker(sql: string): string | null {
  const match = APPROVAL_MARKER.exec(sql);
  return match ? match[1] : null;
}

/** Enum values added by `ALTER TYPE ... ADD VALUE '<v>'` (rule 4). */
export function findAddedEnumValues(sql: string): string[] {
  const masked = maskSql(sql, false);
  const values: string[] = [];
  const pattern =
    /\bALTER\s+TYPE\s+\S+\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'((?:[^']|'')+)'/gi;
  for (const match of masked.matchAll(pattern)) {
    values.push(match[1].replace(/''/g, "'"));
  }
  return values;
}

/** Rule 3 applied to one new migration file. */
export function checkMigrationSql(file: string, sql: string): Finding[] {
  const destructive = findDestructiveStatements(sql);
  if (destructive.length === 0) return [];
  const approvedBy = findApprovalMarker(sql);
  return destructive.map(({ kind, line, statement }) => {
    const excerpt =
      statement.length > 120 ? `${statement.slice(0, 117)}...` : statement;
    return approvedBy
      ? {
          level: "warning" as const,
          file,
          line,
          message: `Destructive ${KIND_LABELS[kind]} approved by #${approvedBy}: ${excerpt}`,
        }
      : {
          level: "error" as const,
          file,
          line,
          message:
            `Destructive ${KIND_LABELS[kind]} breaks the previous image after an ` +
            `automatic rollback: ${excerpt}. Make it additive (expand/contract), or ` +
            `add "-- destructive-approved: #<issue>" to the migration ` +
            `(docs/exploitation/deploiement-azure.md).`,
        };
  });
}

/**
 * Rule 4 (warning only): an added enum value that the PR's own added code
 * lines already mention. `addedCode` maps a file to its added lines.
 */
export function checkEnumProducers(
  enumValues: Map<string, string[]>,
  addedCode: Map<string, string[]>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [migration, values] of enumValues) {
    for (const value of values) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
      for (const [file, lines] of addedCode) {
        if (lines.some((line) => pattern.test(line))) {
          findings.push({
            level: "warning",
            file,
            message:
              `Enum value ${value} is added by ${migration} and already used by ` +
              `this PR: a rollback to an image older than the migration cannot ` +
              `read rows carrying it. Ship the enum value in its own PR first (#269).`,
          });
        }
      }
    }
  }
  return findings;
}

/** Parses `git diff -U0` output into the added lines of each file. */
export function parseAddedLines(diff: string): Map<string, string[]> {
  const added = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      current = line.startsWith("+++ b/") ? line.slice(6) : null;
      if (current !== null && !added.has(current)) added.set(current, []);
    } else if (current !== null && line.startsWith("+")) {
      added.get(current)?.push(line.slice(1));
    }
  }
  return added;
}

/** GitHub workflow command for a finding (properties and data escaped). */
export function formatAnnotation(finding: Finding): string {
  const escapeData = (s: string) =>
    s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const escapeProp = (s: string) =>
    escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const props: string[] = [];
  if (finding.file) props.push(`file=${escapeProp(finding.file)}`);
  if (finding.line) props.push(`line=${finding.line}`);
  const head =
    props.length > 0
      ? `::${finding.level} ${props.join(",")}`
      : `::${finding.level}`;
  return `${head}::${escapeData(finding.message)}`;
}
