/**
 * Guard for the local-development scripts that wipe the database
 * (`seed.ts`, `sync-licensees-from-compete.ts`, #880).
 *
 * They empty whole tables, licences included: run by mistake against staging
 * or production they would destroy real data. They refuse to run unless the
 * target is plainly local — `NODE_ENV` is not `production` AND the database
 * host is the machine itself or a docker-compose service — or the operator
 * passes `--allow-non-local-db` explicitly.
 *
 * Pure (inputs passed in) so it is unit-tested without touching any database.
 */

/** CLI flag that lifts the guard, for a deliberate run. */
export const ALLOW_NON_LOCAL_DB_FLAG = "--allow-non-local-db";

/**
 * Hosts accepted as local: loopback, and the docker-compose service names
 * (`db` in docker-compose.yml) or the host seen from a container.
 */
export const LOCAL_DATABASE_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "db",
  "postgres",
  "host.docker.internal",
]);

export interface LocalDatabaseGuardInput {
  databaseUrl: string | undefined;
  nodeEnv: string | undefined;
  argv: readonly string[];
}

/**
 * Host the connection string targets, lower-cased, or null when it cannot be
 * read. A `host` query parameter (libpq) wins over the authority; a host
 * starting with `/` is a Unix socket, i.e. this machine.
 */
export function databaseHost(databaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  const queryHost = url.searchParams.get("host");
  if (queryHost !== null && queryHost !== "") {
    return queryHost.startsWith("/") ? "localhost" : queryHost.toLowerCase();
  }
  // IPv6 hosts come back bracketed (`[::1]`).
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  return host === "" ? "localhost" : host;
}

/**
 * Why the script must not run, or null when it may. Never echoes the
 * connection string (it holds the password).
 */
export function nonLocalDatabaseReason(
  input: LocalDatabaseGuardInput,
): string | null {
  if (input.argv.includes(ALLOW_NON_LOCAL_DB_FLAG)) return null;
  if (input.nodeEnv === "production") {
    return "NODE_ENV=production";
  }
  if (!input.databaseUrl) {
    return "DATABASE_URL is not set";
  }
  const host = databaseHost(input.databaseUrl);
  if (host === null) {
    return "DATABASE_URL cannot be parsed";
  }
  if (!LOCAL_DATABASE_HOSTS.has(host)) {
    return `database host "${host}" is not local`;
  }
  return null;
}

/**
 * Exits the process (code 1) with an explanation when the target is not
 * local. Call it before the script's first query.
 */
export function assertLocalDatabase(
  scriptName: string,
  input: LocalDatabaseGuardInput,
  exit: (code: number) => never = process.exit,
): void {
  const reason = nonLocalDatabaseReason(input);
  if (reason === null) return;
  console.error(
    `${scriptName} refuses to run: ${reason}. It wipes the database and is ` +
      `meant for local development only. Pass ${ALLOW_NON_LOCAL_DB_FLAG} to ` +
      `run it anyway.`,
  );
  exit(1);
}
