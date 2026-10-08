import {
  redactSecretsDeep,
  redactSecretsInText,
  redactUrl,
} from "./redact-url";

const TOKEN = "q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW";
const R = "[REDACTED]";

describe("redactUrl", () => {
  it.each([
    ["plain path", `/api/v1/licenses/wallet/apple/${TOKEN}`],
    ["query string", `/api/v1/licenses/wallet/apple/${TOKEN}?a=1&b=2`],
    ["trailing slash", `/api/v1/licenses/wallet/apple/${TOKEN}/`],
    ["fragment", `/api/v1/licenses/wallet/apple/${TOKEN}#x`],
    ["without the api/v1 prefix", `/licenses/wallet/apple/${TOKEN}`],
    [
      "upper case (Express routes case-insensitively)",
      `/API/V1/LICENSES/WALLET/APPLE/${TOKEN}`,
    ],
    ["mixed case", `/api/v1/Licenses/Wallet/APPLE/${TOKEN}`],
    ["repeated slashes", `/api/v1//licenses//wallet//apple//${TOKEN}`],
    ["encoded separators", `/api/v1/licenses%2Fwallet%2Fapple%2F${TOKEN}`],
    [
      "lower-case encoded separators",
      `/api/v1/licenses%2fwallet%2fapple%2f${TOKEN}`,
    ],
    [
      "double-encoded separators",
      `/api/v1/licenses%252Fwallet%252Fapple%252F${TOKEN}`,
    ],
    [
      "encoded slash inside the token",
      `/api/v1/licenses/wallet/apple/${TOKEN.slice(0, 10)}%2F${TOKEN.slice(10)}`,
    ],
    [
      "full URL",
      `https://api.example.org/api/v1/licenses/wallet/apple/${TOKEN}`,
    ],
  ])("hides the Wallet pass token: %s", (_case, url) => {
    const out = redactUrl(url);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(TOKEN.slice(10));
    expect(out).toContain(R);
  });

  it("keeps what follows the token (query, trailing slash)", () => {
    expect(redactUrl(`/api/v1/licenses/wallet/apple/${TOKEN}?a=1`)).toBe(
      `/api/v1/licenses/wallet/apple/${R}?a=1`,
    );
    expect(redactUrl(`/api/v1/licenses/wallet/apple/${TOKEN}/`)).toBe(
      `/api/v1/licenses/wallet/apple/${R}/`,
    );
  });

  it("gives a constant value, usable as a low-cardinality metric label", () => {
    expect(redactUrl(`/api/v1/licenses/wallet/apple/${TOKEN}`)).toBe(
      redactUrl(`/api/v1/licenses/wallet/apple/${"x".repeat(43)}`),
    );
  });

  it("leaves other URLs untouched (including the POST route)", () => {
    expect(redactUrl("/api/v1/licenses/my/wallet/apple")).toBe(
      "/api/v1/licenses/my/wallet/apple",
    );
    expect(redactUrl("/api/v1/users/me?x=1")).toBe("/api/v1/users/me?x=1");
  });

  it("handles a missing URL", () => {
    expect(redactUrl(undefined)).toBe("");
  });
});

describe("redactSecretsInText", () => {
  it("redacts a path echoed in an error message (Nest 404)", () => {
    expect(
      redactSecretsInText(
        `Cannot GET /api/v1/licenses/wallet/apple/${TOKEN}/extra`,
      ),
    ).toBe(`Cannot GET /api/v1/licenses/wallet/apple/${R}/extra`);
  });

  it("stops at quotes and whitespace", () => {
    expect(
      redactSecretsInText(`"url":"/licenses/wallet/apple/${TOKEN}" next`),
    ).toBe(`"url":"/licenses/wallet/apple/${R}" next`);
  });
});

describe("redactSecretsDeep", () => {
  it("redacts strings at any depth without mutating the input", () => {
    const input = {
      request: { url: `https://h/api/v1/licenses/wallet/apple/${TOKEN}` },
      spans: [{ data: { "url.full": `/licenses/wallet/apple/${TOKEN}` } }],
      count: 3,
      flag: true,
      nothing: null,
    };
    const out = redactSecretsDeep(input);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(out.count).toBe(3);
    expect(out.flag).toBe(true);
    expect(out.nothing).toBeNull();
    expect(input.request.url).toContain(TOKEN);
  });

  it("keeps non-plain objects as they are", () => {
    const date = new Date(0);
    const out = redactSecretsDeep({ date, nested: Object.create(null) });
    expect(out.date).toBe(date);
  });

  it("stops recursing on very deep structures", () => {
    let deep: Record<string, unknown> = { leaf: TOKEN };
    for (let i = 0; i < 30; i++) deep = { child: deep };
    expect(() => redactSecretsDeep(deep)).not.toThrow();
  });
});
