import {
  type CommandResult,
  type CommandRunner,
  MIGRATE_DEPLOY_ARGS,
  migrateDeployFailureMessage,
  prepareTestDatabase,
  SCHEMA_DRIFT_ARGS,
  SCHEMA_DRIFT_MESSAGE,
  TestDatabasePreparationError,
} from "./prepare-test-db.utils";

const ok: CommandResult = { status: 0, output: "" };

function runnerReturning(
  deploy: CommandResult,
  drift: CommandResult = ok,
): jest.MockedFunction<CommandRunner> {
  return jest.fn((args: readonly string[]) =>
    args[1] === "deploy" ? deploy : drift,
  );
}

describe("prepareTestDatabase", () => {
  it("runs migrate deploy then the drift check, in that order", () => {
    const run = runnerReturning(ok);

    prepareTestDatabase(run);

    expect(run.mock.calls).toEqual([
      [MIGRATE_DEPLOY_ARGS],
      [SCHEMA_DRIFT_ARGS],
    ]);
  });

  it("never falls back to db push", () => {
    const run = runnerReturning(ok);

    prepareTestDatabase(run);

    for (const [args] of run.mock.calls) {
      expect(args).not.toContain("push");
      expect(args).not.toContain("--accept-data-loss");
    }
  });

  it("checks the migrated database against the schema with an exit code", () => {
    expect(SCHEMA_DRIFT_ARGS).toEqual([
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "./prisma/schema",
      "--exit-code",
    ]);
  });

  it("fails, without running the drift check, when a migration does not apply", () => {
    const run = runnerReturning({ status: 1, output: "ERROR: syntax error" });

    expect(() => prepareTestDatabase(run)).toThrow(
      TestDatabasePreparationError,
    );
    expect(() => prepareTestDatabase(run)).toThrow(
      /a migration does not apply/,
    );
    expect(run).not.toHaveBeenCalledWith(SCHEMA_DRIFT_ARGS);
  });

  it("fails when migrate deploy could not be spawned (null status)", () => {
    const run = runnerReturning({ status: null, output: "ENOENT" });

    expect(() => prepareTestDatabase(run)).toThrow(
      /a migration does not apply/,
    );
  });

  it("explains how to recover from a database created by db push (P3005)", () => {
    const run = runnerReturning({
      status: 1,
      output: "Error: P3005\nThe database schema is not empty.",
    });

    expect(() => prepareTestDatabase(run)).toThrow(/P3005/);
    expect(() => prepareTestDatabase(run)).toThrow(
      /fresh, empty test database/,
    );
  });

  it("fails when the schema has a change without a migration (exit code 2)", () => {
    const run = runnerReturning(ok, { status: 2, output: "[+] Added column" });

    expect(() => prepareTestDatabase(run)).toThrow(SCHEMA_DRIFT_MESSAGE);
  });

  it("fails when the drift check itself errors", () => {
    const run = runnerReturning(ok, { status: 1, output: "P1001" });

    expect(() => prepareTestDatabase(run)).toThrow(
      /prisma migrate diff failed/,
    );
  });
});

describe("migrateDeployFailureMessage", () => {
  it("returns the generic message for a failure other than P3005", () => {
    expect(migrateDeployFailureMessage("P3018 migration failed")).toMatch(
      /a migration does not apply/,
    );
  });
});
