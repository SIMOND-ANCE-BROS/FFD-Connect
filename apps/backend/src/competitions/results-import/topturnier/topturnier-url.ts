import { BlockList, isIP } from "net";

/**
 * TEMPORARY (#787) — URL import of a public TopTurnier export, until the FFD
 * gives access to its results data (#651). Remove this module, its service,
 * its endpoint and the TOPTURNIER_* variables then.
 *
 * Pure helpers of the SSRF guard: which URLs may be fetched, which addresses
 * may be connected to.
 */

/** Default allowlist: the public site where TopTurnier exports are published. */
export const DEFAULT_TOPTURNIER_ALLOWED_HOSTS = ["chairperson.ddsbagnols.com"];

/** Max length of a submitted URL. */
export const MAX_TOPTURNIER_URL_LENGTH = 2048;

export class TopTurnierUrlError extends Error {}

/**
 * Hosts of `TOPTURNIER_ALLOWED_HOSTS` (comma separated, case-insensitive),
 * the default list when unset or empty. A wildcard or a value with a scheme,
 * port or path is dropped, never widened.
 */
export function parseAllowedHosts(raw: string | undefined): string[] {
  const hosts = (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => /^(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(host));
  return hosts.length > 0 ? hosts : [...DEFAULT_TOPTURNIER_ALLOWED_HOSTS];
}

/**
 * The URL, checked: https only, no credentials, default port only, host in
 * the allowlist (exact match, no subdomain), never an IP literal. Applied to
 * the submitted URL and to every redirect hop, so a downgrade to plain http
 * (readable and alterable on the way) is refused too. The allowlisted site
 * serves its exports over https (checked 2026-10-18).
 */
export function checkTopTurnierUrl(
  raw: string,
  allowedHosts: readonly string[],
): URL {
  if (raw.length > MAX_TOPTURNIER_URL_LENGTH) {
    throw new TopTurnierUrlError("Adresse trop longue");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new TopTurnierUrlError("Adresse invalide");
  }
  if (url.protocol !== "https:") {
    throw new TopTurnierUrlError("Adresse en https:// uniquement");
  }
  if (url.username !== "" || url.password !== "") {
    throw new TopTurnierUrlError("Adresse avec identifiants refusée");
  }
  if (url.port !== "") {
    throw new TopTurnierUrlError("Port non standard refusé");
  }
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) {
    throw new TopTurnierUrlError("Adresse IP refusée : nom de site attendu");
  }
  if (!allowedHosts.includes(host)) {
    throw new TopTurnierUrlError(
      `Site non autorisé pour l'import (autorisés : ${allowedHosts.join(", ")})`,
    );
  }
  return url;
}

/**
 * Folder URL of the export from the address of its competition page
 * (`…/index.htm`) or of its folder (`…/`, `…/folder`). Query and fragment
 * are dropped.
 */
export function exportBaseUrl(url: URL): URL {
  const base = new URL(url.href);
  base.search = "";
  base.hash = "";
  if (/\/index\.html?$/i.test(base.pathname)) {
    base.pathname = base.pathname.replace(/index\.html?$/i, "");
  } else if (!base.pathname.endsWith("/")) {
    base.pathname = `${base.pathname}/`;
  }
  return base;
}

/** Host + path of a URL, for the audit trail (never the query). */
export function auditUrl(url: URL): string {
  return `${url.hostname}${url.pathname}`;
}

/**
 * Addresses never connected to: loopback, private, link-local, CGNAT,
 * multicast, reserved, documentation, the Azure platform address
 * (168.63.129.16, wireserver: DNS, health probes, VM agent), unique-local IPv6
 * and the IPv4 ranges reachable through IPv6 transition prefixes
 * (IPv4-compatible, -mapped, -translated, NAT64, 6to4, Teredo).
 */
// Two lists: Node's BlockList matches an IPv4 address against the IPv6
// ::ffff:0:0/96 subnet, which would block every IPv4 address.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["168.63.129.16", 32],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_V4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_V6.addSubnet(network, prefix, "ipv6");
}

/** True when the resolved address may be connected to (public unicast). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED_V4.check(address, "ipv4");
  // IPv4-compatible / mapped / translated IPv6 (::a.b.c.d, ::ffff:a.b.c.d,
  // ::ffff:0:a.b.c.d, 64:ff9b::/96) are blocked as a whole: a public site
  // answers on a native address.
  if (family === 6) return !BLOCKED_V6.check(address, "ipv6");
  return false;
}
