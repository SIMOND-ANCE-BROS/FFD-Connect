import { anonymizeIp, UNKNOWN_IP } from "./anonymize-ip";

describe("anonymizeIp (RGPD, #529)", () => {
  it.each([
    ["203.0.113.42", "203.0.113.0/24"],
    ["10.0.0.1", "10.0.0.0/24"],
    [" 198.51.100.7 ", "198.51.100.0/24"],
    // Dual-stack socket: the IPv4 is unwrapped, then truncated.
    ["::ffff:203.0.113.42", "203.0.113.0/24"],
    ["::FFFF:203.0.113.42", "203.0.113.0/24"],
  ])("truncates IPv4 %p to its /24 network", (ip, expected) => {
    expect(anonymizeIp(ip)).toBe(expected);
  });

  it.each([
    ["2001:db8:abcd:12:34:56:78:9a", "2001:db8:abcd::/48"],
    ["2001:0DB8:00AB:0012::1", "2001:db8:ab::/48"],
    ["2001:db8::1", "2001:db8:0::/48"],
    ["::1", "0:0:0::/48"],
    ["::", "0:0:0::/48"],
    ["fe80::1%eth0", "fe80:0:0::/48"],
    ["64:ff9b::192.0.2.33", "64:ff9b:0::/48"],
  ])("truncates IPv6 %p to its /48 network", (ip, expected) => {
    expect(anonymizeIp(ip)).toBe(expected);
  });

  it("never returns the host part of the address", () => {
    expect(anonymizeIp("203.0.113.42")).not.toContain("42");
    expect(anonymizeIp("2001:db8:abcd:12:34:56:78:9a")).not.toMatch(
      /12|34|56|78|9a/,
    );
  });

  it.each([undefined, null, ""])("leaves %p absent", (value) => {
    expect(anonymizeIp(value)).toBeUndefined();
  });

  it.each([
    "not-an-ip",
    "jeanne.martin@example.com",
    "999.1.1.1",
    "::ffff:not-ipv4",
    "1.2.3",
  ])("never echoes a malformed value (%p)", (value) => {
    expect(anonymizeIp(value)).toBe(UNKNOWN_IP);
  });

  it("never echoes a non-string value", () => {
    expect(anonymizeIp(42)).toBe(UNKNOWN_IP);
    expect(anonymizeIp({ ip: "203.0.113.42" })).toBe(UNKNOWN_IP);
  });
});
