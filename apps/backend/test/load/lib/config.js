/**
 * Shared configuration of the k6 load tests (issue #488).
 *
 * Everything comes from the environment (`k6 run -e KEY=value` or exported
 * variables): no URL default other than localhost, no credential in the repo.
 * Runbook (French): docs/exploitation/tests-de-charge.md.
 */
import exec from "k6/execution";

/** Hosts a load test may target without any further flag. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"];

/** Staging API: allowed only with K6_ALLOW_STAGING=yes (Gabin's approval). */
export const STAGING_HOST = "api-staging.ffd.gabin-simond.fr";

/**
 * Parses the host of an URL without the URL API (not available in the k6
 * runtime): `scheme://host[:port]/...` → `host`.
 */
export function hostOf(url) {
  const match = /^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(String(url));
  return match ? match[1].toLowerCase() : null;
}

function isPrivateIpv4(host) {
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/**
 * Guard: the target must be local (or a private address), or staging with an
 * explicit opt-in. Production — and any other public host, including the raw
 * `*.azurecontainerapps.io` FQDN of an app — is refused, with no override.
 */
export function assertSafeTarget(baseUrl, allowStaging) {
  const host = hostOf(baseUrl);
  if (!host) {
    throw new Error(`BASE_URL invalide : "${baseUrl}"`);
  }
  if (LOCAL_HOSTS.includes(host) || isPrivateIpv4(host)) {
    return "local";
  }
  if (host === STAGING_HOST) {
    if (!allowStaging) {
      throw new Error(
        `Cible staging refusée sans K6_ALLOW_STAGING=yes : une campagne contre staging exige l'accord explicite de Gabin (voir docs/exploitation/tests-de-charge.md).`,
      );
    }
    return "staging";
  }
  throw new Error(
    `Cible refusée : ${host}. Seuls localhost / une IP privée, ou staging avec K6_ALLOW_STAGING=yes, sont autorisés. Jamais la prod.`,
  );
}

function intEnv(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} doit être un entier positif (reçu "${raw}")`);
  }
  return value;
}

export const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(
  /\/+$/,
  "",
);
export const API = `${BASE_URL}/api/v1`;
export const TARGET = assertSafeTarget(
  BASE_URL,
  __ENV.K6_ALLOW_STAGING === "yes",
);

/**
 * One distinct `X-Forwarded-For` per virtual user, so that each VU stands for
 * a different phone for the per-IP rate limiter (100 req/min, login 5/min).
 * Only effective when the backend runs with TRUST_PROXY_HOPS=1 and NO proxy in
 * front (local run): behind the Azure ingress the header is ignored by design
 * (#182, #383) and every VU shares the runner's real IP. Default: on locally,
 * off elsewhere. SHARED_IP=true forces one address for all VUs (gym Wi-Fi).
 */
export const SPOOF_IPS =
  __ENV.SHARED_IP === "true"
    ? false
    : __ENV.SPOOF_IPS
      ? __ENV.SPOOF_IPS === "true"
      : TARGET === "local";

/** Password shared by the seeded load-test accounts (seed-load-test.ts). */
export const PASSWORD = __ENV.LOAD_PASSWORD || "";

/** Seeded accounts: emails derived from a pattern, `{n}` = zero-padded index. */
export const LICENSEE_PATTERN =
  __ENV.LOAD_LICENSEE_PATTERN || "load-licensee-{n}@load.invalid";
export const LICENSEE_COUNT = intEnv("LOAD_LICENSEE_COUNT", 200);
export const SCANNER_PATTERN =
  __ENV.LOAD_SCANNER_PATTERN || "load-scanner-{n}@load.invalid";
export const SCANNER_COUNT = intEnv("LOAD_SCANNER_COUNT", 10);
/** Competition seeded with confirmed, paid registrations for the burst. */
export const COMPETITION_ID = __ENV.LOAD_COMPETITION_ID || "load-comp";

/** Multiplier applied to every rate / VU count (0.1 = 10 % of the profile). */
export const SCALE = Number(__ENV.SCALE || "1");
if (!(SCALE > 0)) {
  throw new Error(`SCALE doit être > 0 (reçu "${__ENV.SCALE}")`);
}

export function scaled(value) {
  return Math.max(1, Math.round(value * SCALE));
}

export function accountEmail(pattern, index) {
  const n = String(index + 1).padStart(4, "0");
  return pattern.replace("{n}", n);
}

export function licenseeEmail(index) {
  return accountEmail(LICENSEE_PATTERN, index % LICENSEE_COUNT);
}

export function scannerEmail(index) {
  return accountEmail(SCANNER_PATTERN, index % SCANNER_COUNT);
}

/**
 * Sessions opened in setup(). Without fake IPs the logins are spaced 13 s
 * apart (5/min per IP), so the default stays small: 10 logins ≈ 2 min.
 */
export function defaultSessions(wanted) {
  const fallback = SPOOF_IPS ? wanted : Math.min(wanted, 10);
  return Math.min(LICENSEE_COUNT, intEnv("SESSIONS", fallback));
}

/** Fake but stable client IP of a VU: 10.(vu/65536).(vu/256).(vu%256). */
export function fakeIpForVu(vu) {
  const id = vu + 1;
  return `10.${(id >> 16) & 255}.${(id >> 8) & 255}.${id & 255}`;
}

/**
 * Fake IP of the phone of seeded account #index, for executors that reuse a
 * VU for many short iterations (arrival rate): the budget then follows the
 * dancer, not the VU.
 */
export function fakeIpForAccount(index) {
  return `10.100.${(index >> 8) & 255}.${index & 255}`;
}

/** Fake IP for a setup()/teardown() step (`slot` keeps them distinct). */
export function fakeIpForSetup(slot) {
  return `10.250.${(slot >> 8) & 255}.${slot & 255}`;
}

/** Headers common to every request of the current VU. */
export function baseHeaders(extra) {
  const headers = { Accept: "application/json", ...(extra || {}) };
  if (SPOOF_IPS && !headers["X-Forwarded-For"]) {
    let vu = 0;
    try {
      vu = exec.vu.idInTest;
    } catch {
      vu = 0; // setup()/teardown(): caller passes its own X-Forwarded-For
    }
    headers["X-Forwarded-For"] = fakeIpForVu(vu);
  }
  return headers;
}

export function requirePassword() {
  if (!PASSWORD) {
    throw new Error(
      "LOAD_PASSWORD manquant : mot de passe des comptes de charge (celui passé à seed-load-test.ts). Jamais dans le dépôt.",
    );
  }
}
