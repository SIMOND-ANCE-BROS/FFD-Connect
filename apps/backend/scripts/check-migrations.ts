/**
 * CI check of a PR's Prisma migrations (#494): rules in
 * check-migrations.utils.ts, runbook in docs/exploitation/deploiement-azure.md
 * (« Migrations et rétrocompatibilité »).
 *
 * Usage (from anywhere in the repo):
 *   pnpm --filter backend exec tsx scripts/check-migrations.ts [--base <ref>] [--head <ref>]
 *
 * Defaults: --base HEAD^1 --head HEAD — in CI, HEAD is the PR merge commit (or
 * the merge-queue commit) and HEAD^1 the target branch it merges into, so the
 * checkout needs `fetch-depth: 2`. Locally, compare a branch with its target:
 *   --base origin/develop --head origin/<branch>
 * The PR's changes are taken from merge-base(base, head) to head; the ordering
 * rule compares with the migrations present on base itself.
 *
 * Reads git objects only (no checkout, no database, no network). Exit code 1
 * when a rule fails; warnings never fail. On GitHub Actions, findings are also
 * emitted as annotations and summarised in the job summary.
 */
import { execFileSync } from "child_process";
import { appendFileSync } from "fs";
import {
  Finding,
  MIGRATIONS_DIR,
  checkEnumProducers,
  checkMigrationSql,
  checkOrdering,
  classifyMigrationChanges,
  findAddedEnumValues,
  formatAnnotation,
  migrationFoldersFromListing,
  parseAddedLines,
  parseNameStatus,
} from "./check-migrations.utils";

/** Application code where writing a freshly added enum value is risky (#269). */
const PRODUCER_PATHS = ["apps/backend/src", ":(exclude)*.spec.ts"];

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

function main(): number {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const base = argValue("--base", "HEAD^1");
  const head = argValue("--head", "HEAD");

  let from: string;
  try {
    from = git(["merge-base", base, head], root).trim();
  } catch {
    from = base;
  }

  const baseFolders = migrationFoldersFromListing(
    git(["ls-tree", "--name-only", `${base}:${MIGRATIONS_DIR}`], root),
  );
  const changes = parseNameStatus(
    git(
      [
        "diff",
        "--name-status",
        "--no-renames",
        from,
        head,
        "--",
        MIGRATIONS_DIR,
      ],
      root,
    ),
  );
  const { added, findings } = classifyMigrationChanges(changes, baseFolders);
  findings.push(...checkOrdering(added, baseFolders));

  const enumValues = new Map<string, string[]>();
  for (const folder of added) {
    const file = `${MIGRATIONS_DIR}/${folder}/migration.sql`;
    let sql: string;
    try {
      sql = git(["show", `${head}:${file}`], root);
    } catch {
      findings.push({
        level: "error",
        file,
        message: `New migration ${folder} has no migration.sql.`,
      });
      continue;
    }
    findings.push(...checkMigrationSql(file, sql));
    const values = findAddedEnumValues(sql);
    if (values.length > 0) enumValues.set(folder, values);
  }
  if (enumValues.size > 0) {
    const diff = git(
      ["diff", "-U0", from, head, "--", ...PRODUCER_PATHS],
      root,
    );
    findings.push(...checkEnumProducers(enumValues, parseAddedLines(diff)));
  }

  report(base, head, added, findings);
  return findings.some((f) => f.level === "error") ? 1 : 0;
}

function report(
  base: string,
  head: string,
  added: string[],
  findings: Finding[],
): void {
  const onActions = process.env.GITHUB_ACTIONS === "true";
  console.log(`Prisma migrations check (#494): ${base} -> ${head}`);
  console.log(
    added.length > 0
      ? `New migrations: ${added.join(", ")}`
      : "No new migration.",
  );
  for (const finding of findings) {
    const where = finding.file
      ? ` ${finding.file}${finding.line ? `:${finding.line}` : ""}`
      : "";
    console.log(`[${finding.level.toUpperCase()}]${where} ${finding.message}`);
    if (onActions) console.log(formatAnnotation(finding));
  }
  const errors = findings.filter((f) => f.level === "error").length;
  console.log(
    errors > 0
      ? `${errors} error(s): see docs/exploitation/deploiement-azure.md (« Migrations et rétrocompatibilité »).`
      : "Migrations OK.",
  );

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (onActions && summary && (added.length > 0 || findings.length > 0)) {
    const lines = [
      "### Prisma migrations (#494)",
      "",
      added.length > 0
        ? `New: ${added.map((a) => `\`${a}\``).join(", ")}`
        : "No new migration.",
      "",
      ...findings.map(
        (f) => `- **${f.level}** ${f.file ? `\`${f.file}\` ` : ""}${f.message}`,
      ),
      "",
    ];
    appendFileSync(summary, lines.join("\n"));
  }
}

try {
  process.exit(main());
} catch (error) {
  // Fail closed: a check that cannot read git must not pass silently.
  console.error(`check-migrations failed: ${(error as Error).message}`);
  process.exit(1);
}
