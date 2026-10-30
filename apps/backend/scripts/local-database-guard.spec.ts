import {
  ALLOW_NON_LOCAL_DB_FLAG,
  assertLocalDatabase,
  databaseHost,
  nonLocalDatabaseReason,
} from "./local-database-guard";

const local = "postgresql://ffd:pw@localhost:5432/ffd_connect";
const remote = "postgresql://ffd:pw@ffd-db.example.net:5432/ffd_connect";

describe("databaseHost", () => {
  it.each([
    [local, "localhost"],
    ["postgresql://u:p@127.0.0.1:5432/x", "127.0.0.1"],
    ["postgresql://u:p@[::1]:5432/x", "::1"],
    ["postgres://ffd:pw@db:5432/ffd_connect", "db"],
    ["postgresql://u:p@LocalHost/x", "localhost"],
    [remote, "ffd-db.example.net"],
    // libpq `host` parameter wins; a socket path is this machine.
    [
      "postgresql://u:p@localhost/x?host=ffd-db.example.net",
      "ffd-db.example.net",
    ],
    ["postgresql:///x?host=/var/run/postgresql", "localhost"],
    ["postgresql:///x", "localhost"],
  ])("%s → %s", (url, host) => {
    expect(databaseHost(url)).toBe(host);
  });

  it("returns null for an unparsable string", () => {
    expect(databaseHost("not a url")).toBeNull();
  });
});

describe("nonLocalDatabaseReason (#880)", () => {
  const input = (
    databaseUrl: string | undefined,
    nodeEnv: string | undefined = "development",
    argv: string[] = [],
  ) => ({ databaseUrl, nodeEnv, argv });

  it.each([
    local,
    "postgresql://u:p@127.0.0.1:5432/x",
    "postgresql://u:p@[::1]:5432/x",
    "postgres://ffd:pw@db:5432/ffd_connect",
    "postgresql://u:p@postgres:5432/x",
    "postgresql://u:p@host.docker.internal:5432/x",
  ])("lets a local database through (%s)", (url) => {
    expect(nonLocalDatabaseReason(input(url))).toBeNull();
    expect(nonLocalDatabaseReason(input(url, undefined))).toBeNull();
    expect(nonLocalDatabaseReason(input(url, "test"))).toBeNull();
  });

  it("refuses a remote host", () => {
    expect(nonLocalDatabaseReason(input(remote))).toBe(
      'database host "ffd-db.example.net" is not local',
    );
  });

  it("refuses a remote host hidden in the host parameter", () => {
    expect(
      nonLocalDatabaseReason(
        input("postgresql://u:p@localhost/x?host=10.0.0.4"),
      ),
    ).toBe('database host "10.0.0.4" is not local');
  });

  it("refuses NODE_ENV=production even against a local host", () => {
    expect(nonLocalDatabaseReason(input(local, "production"))).toBe(
      "NODE_ENV=production",
    );
  });

  it("refuses a missing or unparsable DATABASE_URL", () => {
    expect(nonLocalDatabaseReason(input(undefined))).toBe(
      "DATABASE_URL is not set",
    );
    expect(nonLocalDatabaseReason(input(""))).toBe("DATABASE_URL is not set");
    expect(nonLocalDatabaseReason(input("garbage"))).toBe(
      "DATABASE_URL cannot be parsed",
    );
  });

  it("is lifted only by the explicit flag", () => {
    expect(
      nonLocalDatabaseReason(
        input(remote, "production", [ALLOW_NON_LOCAL_DB_FLAG]),
      ),
    ).toBeNull();
    expect(
      nonLocalDatabaseReason(input(remote, "production", ["--force"])),
    ).toBe("NODE_ENV=production");
  });

  it("never echoes the connection string (it holds the password)", () => {
    const reason = nonLocalDatabaseReason(
      input("postgresql://ffd:s3cret@ffd-db.example.net/x"),
    );
    expect(reason).not.toContain("s3cret");
  });
});

describe("assertLocalDatabase", () => {
  let error: jest.SpyInstance;
  beforeEach(() => {
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => error.mockRestore());

  const exitMock = () =>
    jest.fn((code: number): never => {
      throw new Error(`exit ${code}`);
    });

  it("returns quietly for a local database", () => {
    const exit = exitMock();
    assertLocalDatabase(
      "seed",
      { databaseUrl: local, nodeEnv: "development", argv: [] },
      exit,
    );
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("exits with code 1 and names the reason and the flag otherwise", () => {
    const exit = exitMock();
    expect(() =>
      assertLocalDatabase(
        "seed",
        { databaseUrl: remote, nodeEnv: "development", argv: [] },
        exit,
      ),
    ).toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
    const message = String(error.mock.calls[0][0]);
    expect(message).toContain("seed refuses to run");
    expect(message).toContain("ffd-db.example.net");
    expect(message).toContain(ALLOW_NON_LOCAL_DB_FLAG);
    expect(message).not.toContain("pw@");
  });
});
