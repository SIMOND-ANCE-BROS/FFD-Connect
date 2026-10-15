import { isIPv4, isIPv6 } from "net";

/**
 * Value logged instead of anything that is not a valid IP address: the raw
 * input is never echoed back, whatever it holds.
 */
export const UNKNOWN_IP = "unknown";

/** Prefix of an IPv4 address reported by a dual-stack (IPv6) socket. */
const IPV4_MAPPED_PREFIX = "::ffff:";

/** IPv4 truncated to its /24 network: `203.0.113.42` → `203.0.113.0/24`. */
function truncateIpv4(ip: string): string {
  const [a, b, c] = ip.split(".");
  return `${a}.${b}.${c}.0/24`;
}

/**
 * IPv6 truncated to its /48 network:
 * `2001:db8:abcd:12::1` → `2001:db8:abcd::/48`.
 */
function truncateIpv6(ip: string): string {
  const parts: (string | undefined)[] = ip.split("::");
  const [head, tail] = parts;
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  // `::` stands for the missing zero groups (8 in total).
  const groups =
    parts.length === 1
      ? headGroups
      : [
          ...headGroups,
          ...Array<string>(8 - headGroups.length - tailGroups.length).fill("0"),
          ...tailGroups,
        ];
  const network = groups
    .slice(0, 3)
    .map((group) => parseInt(group, 16).toString(16));
  return `${network.join(":")}::/48`;
}

/**
 * Truncates a client IP before it reaches the logs (RGPD, #529).
 *
 * An IP address is personal data. The logs keep only the network it belongs
 * to — IPv4 /24, IPv6 /48 — which is enough to spot an abusive range or a
 * country during a security investigation, but no longer designates one
 * subscriber. A (keyed) hash was ruled out: the IPv4 space is small enough to
 * brute-force an unkeyed hash, and a keyed one is a secret to manage for no
 * gain over the network prefix. Decision recorded in
 * `docs/exploitation/donnees-personnelles-logs.md`.
 *
 * An IPv4-mapped IPv6 (`::ffff:1.2.3.4`, what Node reports on a dual-stack
 * socket) is unwrapped first; a zone index (`fe80::1%eth0`) is dropped.
 * Anything else — empty, malformed, not a string — becomes `undefined`
 * (absent) or {@link UNKNOWN_IP}, never the raw value.
 */
export function anonymizeIp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return UNKNOWN_IP;
  }
  const ip = value.trim().split("%")[0] ?? "";
  const lower = ip.toLowerCase();
  if (lower.startsWith(IPV4_MAPPED_PREFIX)) {
    const mapped = ip.slice(IPV4_MAPPED_PREFIX.length);
    if (isIPv4(mapped)) {
      return truncateIpv4(mapped);
    }
  }
  if (isIPv4(ip)) {
    return truncateIpv4(ip);
  }
  if (isIPv6(ip)) {
    // An IPv6 written with an embedded IPv4 tail (`64:ff9b::1.2.3.4`) only
    // matters for its first 48 bits, which are always hex groups.
    return truncateIpv6(lower.replace(/:\d+\.\d+\.\d+\.\d+$/, ":0:0"));
  }
  return UNKNOWN_IP;
}
