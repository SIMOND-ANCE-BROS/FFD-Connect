import {
  DEFAULT_TOPTURNIER_ALLOWED_HOSTS,
  TopTurnierUrlError,
  auditUrl,
  checkTopTurnierUrl,
  exportBaseUrl,
  isPublicAddress,
  parseAllowedHosts,
} from "./topturnier-url";

const HOSTS = ["results.example.org"];

describe("parseAllowedHosts", () => {
  it("defaults to the public TopTurnier site", () => {
    expect(parseAllowedHosts(undefined)).toEqual(
      DEFAULT_TOPTURNIER_ALLOWED_HOSTS,
    );
    expect(parseAllowedHosts(" , ")).toEqual(DEFAULT_TOPTURNIER_ALLOWED_HOSTS);
  });

  it("reads a comma separated list, lower-cased", () => {
    expect(parseAllowedHosts("A.Example.org, b.example.net")).toEqual([
      "a.example.org",
      "b.example.net",
    ]);
  });

  it("drops wildcards, schemes, ports, paths and IP literals", () => {
    expect(
      parseAllowedHosts(
        "*.example.org,https://x.example.org,x.example.org:8080,x.example.org/a,10.0.0.1,localhost,ok.example.org",
      ),
    ).toEqual(["ok.example.org"]);
  });
});

describe("checkTopTurnierUrl (SSRF guard)", () => {
  const refused = (url: string) =>
    expect(() => checkTopTurnierUrl(url, HOSTS)).toThrow(TopTurnierUrlError);

  it("accepts https URLs of an allowed host", () => {
    expect(
      checkTopTurnierUrl("https://results.example.org/2026/x/index.htm", HOSTS)
        .href,
    ).toBe("https://results.example.org/2026/x/index.htm");
    expect(
      checkTopTurnierUrl("https://RESULTS.example.org/x/", HOSTS).hostname,
    ).toBe("results.example.org");
  });

  it("refuses plain http, even on an allowed host", () => {
    expect(() =>
      checkTopTurnierUrl("http://results.example.org/x/index.htm", HOSTS),
    ).toThrow("https:// uniquement");
  });

  it.each([
    "ftp://results.example.org/x/",
    "file:///etc/passwd",
    "gopher://results.example.org/",
    "javascript:alert(1)",
    "data:text/html,x",
  ])("refuses another scheme: %s", refused);

  it.each([
    "https://evil.example.com/x/",
    "https://results.example.org.evil.com/x/",
    "https://sub.results.example.org/x/",
    "https://evilresults.example.org/x/",
    "https://localhost/x/",
  ])("refuses a host outside the allowlist: %s", refused);

  it.each([
    "http://127.0.0.1/x/",
    "http://[::1]/x/",
    "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/",
    "http://0x7f000001/",
  ])("refuses an IP literal: %s", refused);

  it("refuses credentials and non-default ports", () => {
    refused("https://user:pw@results.example.org/x/");
    refused("https://results.example.org@evil.example.com/x/");
    refused("https://results.example.org:8443/x/");
    refused("http://results.example.org:22/x/");
  });

  it("refuses garbage and over-long URLs", () => {
    refused("not a url");
    refused(`https://results.example.org/${"a".repeat(3000)}`);
  });
});

describe("exportBaseUrl / auditUrl", () => {
  it("strips the competition page, query and fragment", () => {
    const url = new URL("https://results.example.org/c/2026/index.htm?x=1#a");
    expect(exportBaseUrl(url).href).toBe("https://results.example.org/c/2026/");
    expect(
      exportBaseUrl(new URL("https://results.example.org/c/2026")).href,
    ).toBe("https://results.example.org/c/2026/");
    expect(auditUrl(url)).toBe("results.example.org/c/2026/index.htm");
  });
});

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "168.63.129.16",
    "::7f00:1",
    "::a9fe:a9fe",
    "::8.8.8.8",
    "::ffff:0:7f00:1",
    "::ffff:0:808:808",
    "64:ff9b::a00:1",
    "2002:a00:1::",
    "not-an-ip",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "168.63.129.15",
    "168.63.129.17",
    "2606:4700::1111",
  ])("accepts the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});
