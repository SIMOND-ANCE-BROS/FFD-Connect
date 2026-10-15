import {
  MIGRATIONS_DIR,
  checkEnumProducers,
  checkMigrationSql,
  checkOrdering,
  classifyMigrationChanges,
  findAddedEnumValues,
  findApprovalMarker,
  findDestructiveStatements,
  formatAnnotation,
  maskSql,
  migrationFolderOf,
  migrationFoldersFromListing,
  parseAddedLines,
  parseNameStatus,
} from "./check-migrations.utils";

const BASE = [
  "00000000000000_init",
  "20261012190000_track_correction_delete_reason",
  "20261012200000_retired_license_numbers",
];
const path = (folder: string, file = "migration.sql") =>
  `${MIGRATIONS_DIR}/${folder}/${file}`;
const kinds = (sql: string) =>
  findDestructiveStatements(sql).map((d) => d.kind);

describe("parseNameStatus", () => {
  it("parses git name-status lines", () => {
    expect(parseNameStatus("A\ta/b.sql\nM\tc.sql\n\nD\td.sql\n")).toEqual([
      { status: "A", path: "a/b.sql" },
      { status: "M", path: "c.sql" },
      { status: "D", path: "d.sql" },
    ]);
  });

  it("keeps the status letter only (R100 → R)", () => {
    expect(parseNameStatus("R100\tx")).toEqual([{ status: "R", path: "x" }]);
  });
});

describe("migrationFolderOf / migrationFoldersFromListing", () => {
  it("returns the migration folder of a file under the directory", () => {
    expect(migrationFolderOf(path("20261013000000_x"))).toBe(
      "20261013000000_x",
    );
  });

  it("ignores files outside a migration folder", () => {
    expect(
      migrationFolderOf(`${MIGRATIONS_DIR}/migration_lock.toml`),
    ).toBeNull();
    expect(migrationFolderOf("apps/backend/src/main.ts")).toBeNull();
  });

  it("lists folders, sorted, without migration_lock.toml", () => {
    expect(
      migrationFoldersFromListing("b_2\nmigration_lock.toml\na_1\n\n"),
    ).toEqual(["a_1", "b_2"]);
  });
});

describe("classifyMigrationChanges (rule 1: immutable migrations)", () => {
  it("collects added folders", () => {
    const { added, findings } = classifyMigrationChanges(
      [{ status: "A", path: path("20261013000000_new") }],
      BASE,
    );
    expect(added).toEqual(["20261013000000_new"]);
    expect(findings).toEqual([]);
  });

  it("fails when an existing migration is modified", () => {
    const { findings } = classifyMigrationChanges(
      [{ status: "M", path: path(BASE[1]) }],
      BASE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: "error", file: path(BASE[1]) });
    expect(findings[0].message).toContain("modifies");
  });

  it("fails when an existing migration is deleted", () => {
    const { added, findings } = classifyMigrationChanges(
      [{ status: "D", path: path(BASE[2]) }],
      BASE,
    );
    expect(added).toEqual([]);
    expect(findings[0].message).toContain("deletes");
  });

  it("fails when a file is added inside an existing migration", () => {
    const { findings } = classifyMigrationChanges(
      [{ status: "A", path: path(BASE[2], "extra.sql") }],
      BASE,
    );
    expect(findings).toHaveLength(1);
  });

  it("ignores migration_lock.toml and deletions of folders not on the base", () => {
    const { added, findings } = classifyMigrationChanges(
      [
        { status: "M", path: `${MIGRATIONS_DIR}/migration_lock.toml` },
        { status: "D", path: path("20261013000000_gone") },
      ],
      BASE,
    );
    expect(added).toEqual([]);
    expect(findings).toEqual([]);
  });
});

describe("checkOrdering (rule 2)", () => {
  it("accepts a migration after the latest of the base", () => {
    expect(checkOrdering(["20261013000000_new"], BASE)).toEqual([]);
  });

  it("fails a migration dated before the latest of the base", () => {
    const findings = checkOrdering(["20261012195959_late"], BASE);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(
      "sorts before 20261012200000_retired_license_numbers",
    );
  });

  it("fails a timestamp shared with a base migration, even if the name sorts after", () => {
    // #605 / #628: same 20261015120000 prefix, different slugs.
    const base = [...BASE, "20261015120000_health_data_access_log"];
    const findings = checkOrdering(
      ["20261015120000_user_email_normalized"],
      base,
    );
    expect(findings.map((f) => f.message).join("\n")).toContain(
      "shares its timestamp 20261015120000 with 20261015120000_health_data_access_log",
    );
  });

  it("fails two new migrations sharing a timestamp", () => {
    const findings = checkOrdering(
      ["20261013000000_a", "20261013000000_b"],
      BASE,
    );
    expect(findings).toHaveLength(2);
  });

  it("fails a folder name that is not <timestamp>_<name>", () => {
    const findings = checkOrdering(["2026_bad"], BASE);
    expect(findings[0].message).toContain("does not follow");
  });

  it("accepts anything well-named on an empty base", () => {
    expect(checkOrdering(["00000000000000_init"], [])).toEqual([]);
  });
});

describe("maskSql", () => {
  it("blanks comments, strings and dollar bodies but keeps newlines", () => {
    const sql =
      "-- DROP TABLE x\nSELECT 'DROP TABLE y';\n/* RENAME\n*/ DO $$ DROP TABLE z $$;";
    const masked = maskSql(sql);
    expect(masked).not.toMatch(/DROP|RENAME/);
    expect(masked.split("\n")).toHaveLength(sql.split("\n").length);
    expect(masked).toHaveLength(sql.length);
  });

  it("keeps string contents when asked to", () => {
    expect(maskSql("SELECT 'a''b' -- c", false)).toBe("SELECT 'a''b'     ");
  });

  it("handles tagged dollar quotes and quoted identifiers", () => {
    const masked = maskSql(
      'CREATE FUNCTION f() AS $fn$ DROP TABLE t; $fn$; SELECT "a--b"',
    );
    expect(masked).not.toContain("DROP");
    expect(masked).toContain('"a--b"');
  });
});

describe("findDestructiveStatements (rule 3)", () => {
  it("flags DROP TABLE, DROP TYPE and DROP COLUMN", () => {
    expect(kinds('DROP TABLE "A";')).toEqual(["drop-table"]);
    expect(kinds('DROP TYPE "Kind";')).toEqual(["drop-type"]);
    expect(kinds('ALTER TABLE "User" DROP COLUMN "email";')).toEqual([
      "drop-column",
    ]);
    expect(kinds('ALTER TABLE "User" DROP IF EXISTS "email";')).toEqual([
      "drop-column",
    ]);
  });

  it("does not flag DROP CONSTRAINT, DROP INDEX, DROP TRIGGER, DROP NOT NULL / DEFAULT", () => {
    expect(
      kinds(
        [
          'ALTER TABLE "A" DROP CONSTRAINT "A_fkey";',
          'DROP INDEX "A_idx";',
          'DROP TRIGGER IF EXISTS "t" ON "A";',
          'ALTER TABLE "A" ALTER COLUMN "x" DROP NOT NULL, ALTER COLUMN "y" DROP DEFAULT;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("flags a column type change", () => {
    expect(kinds('ALTER TABLE "A" ALTER COLUMN "x" TYPE INTEGER;')).toEqual([
      "column-type-change",
    ]);
    expect(
      kinds('ALTER TABLE "A" ALTER COLUMN "x" SET DATA TYPE DECIMAL(10,2);'),
    ).toEqual(["column-type-change"]);
  });

  it("flags SET NOT NULL unless the column gets a default in the migration", () => {
    expect(kinds('ALTER TABLE "A" ALTER COLUMN "x" SET NOT NULL;')).toEqual([
      "not-null-without-default",
    ]);
    expect(
      kinds(
        `ALTER TABLE "A" ALTER COLUMN "x" SET DEFAULT 'v';\nALTER TABLE "A" ALTER COLUMN "x" SET NOT NULL;`,
      ),
    ).toEqual([]);
    expect(
      kinds(
        `ALTER TABLE "A" ALTER COLUMN "x" SET DEFAULT 0, ALTER COLUMN "x" SET NOT NULL;`,
      ),
    ).toEqual([]);
    // A default on ANOTHER table's column of the same name does not count.
    expect(
      kinds(
        `ALTER TABLE "B" ALTER COLUMN "x" SET DEFAULT 0;\nALTER TABLE "A" ALTER COLUMN "x" SET NOT NULL;`,
      ),
    ).toEqual(["not-null-without-default"]);
  });

  it("flags ADD COLUMN NOT NULL without default, not with one", () => {
    expect(kinds('ALTER TABLE "A" ADD COLUMN "x" TEXT NOT NULL;')).toEqual([
      "not-null-without-default",
    ]);
    expect(
      kinds(
        `ALTER TABLE "Track" ADD COLUMN "blacklisted" BOOLEAN NOT NULL DEFAULT false,\nADD COLUMN "t" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[];`,
      ),
    ).toEqual([]);
    expect(kinds('ALTER TABLE "A" ADD COLUMN "x" TEXT;')).toEqual([]);
    expect(
      kinds('ALTER TABLE "A" ADD CONSTRAINT "c" CHECK (x IS NOT NULL);'),
    ).toEqual([]);
  });

  it("flags renames of tables, columns and enum values, not indexes or constraints", () => {
    expect(kinds('ALTER TABLE "A" RENAME COLUMN "x" TO "y";')).toEqual([
      "rename",
    ]);
    expect(kinds('ALTER TABLE "A" RENAME TO "B";')).toEqual(["rename"]);
    expect(kinds(`ALTER TYPE "Kind" RENAME VALUE 'A' TO 'B';`)).toEqual([
      "rename",
    ]);
    expect(kinds('ALTER INDEX "a" RENAME TO "b";')).toEqual([]);
    expect(kinds('ALTER TABLE "A" RENAME CONSTRAINT "a" TO "b";')).toEqual([]);
  });

  it("ignores keywords in comments, strings and function bodies", () => {
    const sql = [
      "-- aucun DROP, aucun RENAME",
      'CREATE TABLE "T" ("id" TEXT NOT NULL, "note" TEXT DEFAULT \'DROP TABLE x\');',
      "CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'DROP TABLE y'; END; $$;",
    ].join("\n");
    expect(kinds(sql)).toEqual([]);
  });

  it("reports the 1-based line of each statement", () => {
    const found = findDestructiveStatements(
      '-- header\n\nCREATE TABLE "A" ("id" TEXT);\nDROP TABLE "B";',
    );
    expect(found).toEqual([
      { kind: "drop-table", line: 4, statement: 'DROP TABLE "B"' },
    ]);
  });
});

describe("findApprovalMarker / checkMigrationSql", () => {
  const file = path("20261013000000_drop");

  it("reads the issue number of the marker", () => {
    expect(
      findApprovalMarker("-- destructive-approved: #123\nDROP TABLE a;"),
    ).toBe("123");
    expect(findApprovalMarker("--Destructive-Approved:#7")).toBe("7");
    expect(findApprovalMarker("-- destructive-approved: soon")).toBeNull();
  });

  it("fails destructive SQL without marker", () => {
    const findings = checkMigrationSql(file, 'DROP TABLE "A";');
    expect(findings).toEqual([
      expect.objectContaining({ level: "error", file, line: 1 }),
    ]);
    expect(findings[0].message).toContain("destructive-approved");
  });

  it("downgrades to a warning with the marker", () => {
    const findings = checkMigrationSql(
      file,
      '-- destructive-approved: #42\nDROP TABLE "A";',
    );
    expect(findings).toEqual([
      expect.objectContaining({ level: "warning", line: 2 }),
    ]);
    expect(findings[0].message).toContain("approved by #42");
  });

  it("returns nothing for additive SQL", () => {
    expect(
      checkMigrationSql(file, 'CREATE TABLE "A" ("id" TEXT NOT NULL);'),
    ).toEqual([]);
  });

  it("truncates long statements in the message", () => {
    const columns = Array.from(
      { length: 30 },
      (_, i) => `DROP COLUMN "c${i}"`,
    ).join(", ");
    const [finding] = checkMigrationSql(file, `ALTER TABLE "A" ${columns};`);
    expect(finding.message).toContain("...");
  });
});

describe("enum producers (rule 4, warning only)", () => {
  it("extracts added enum values", () => {
    expect(
      findAddedEnumValues(
        `ALTER TYPE "NotificationType" ADD VALUE 'A_B';\nALTER TYPE "X" ADD VALUE IF NOT EXISTS 'C';\n-- ALTER TYPE "Y" ADD VALUE 'D';`,
      ),
    ).toEqual(["A_B", "C"]);
  });

  it("parses added lines per file from a -U0 diff", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,0 +2 @@",
      "+type: 'A_B',",
      "-removed",
      "diff --git a/src/gone.ts b/src/gone.ts",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "-x",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual(
      new Map([["src/a.ts", ["type: 'A_B',"]]]),
    );
  });

  it("warns when the PR's code already uses the added value", () => {
    const findings = checkEnumProducers(
      new Map([["20261013000000_enum", ["A_B"]]]),
      new Map([
        ["src/a.ts", ["type: NotificationType.A_B,"]],
        ["src/b.ts", ["const A_B_C = 1;"]],
      ]),
    );
    expect(findings).toEqual([
      expect.objectContaining({ level: "warning", file: "src/a.ts" }),
    ]);
  });
});

describe("formatAnnotation", () => {
  it("formats and escapes a GitHub workflow command", () => {
    expect(
      formatAnnotation({
        level: "error",
        file: "a,b:c.sql",
        line: 3,
        message: "50% bad\nok",
      }),
    ).toBe("::error file=a%2Cb%3Ac.sql,line=3::50%25 bad%0Aok");
  });

  it("formats a finding without location", () => {
    expect(formatAnnotation({ level: "warning", message: "m" })).toBe(
      "::warning::m",
    );
  });
});
