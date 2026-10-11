import { ConfigService } from "@nestjs/config";
import {
  applyTrustProxy,
  PRODUCTION_PROXY_HOPS,
  resolveTrustProxyHops,
} from "./trust-proxy";

const configWith = (values: Record<string, unknown>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe("resolveTrustProxyHops", () => {
  it("trusts the Container Apps ingress (1 hop) in production by default", () => {
    expect(PRODUCTION_PROXY_HOPS).toBe(1);
    expect(resolveTrustProxyHops(configWith({ NODE_ENV: "production" }))).toBe(
      1,
    );
  });

  it.each(["development", "test", undefined])(
    "trusts no proxy outside production (NODE_ENV=%s)",
    (nodeEnv) => {
      expect(resolveTrustProxyHops(configWith({ NODE_ENV: nodeEnv }))).toBe(0);
    },
  );

  it.each([
    [0, 0],
    [2, 2],
    ["3", 3],
  ])("uses TRUST_PROXY_HOPS=%p when set", (configured, expected) => {
    expect(
      resolveTrustProxyHops(
        configWith({ NODE_ENV: "production", TRUST_PROXY_HOPS: configured }),
      ),
    ).toBe(expected);
  });

  it.each(["", null, -1, 1.5, "abc"])(
    "falls back on the environment default for an unusable value (%p)",
    (configured) => {
      expect(
        resolveTrustProxyHops(
          configWith({ NODE_ENV: "production", TRUST_PROXY_HOPS: configured }),
        ),
      ).toBe(1);
    },
  );
});

describe("applyTrustProxy", () => {
  it("sets a hop count on the Express app (never `true`)", () => {
    const app = { set: jest.fn() };
    const hops = applyTrustProxy(app, configWith({ NODE_ENV: "production" }));
    expect(hops).toBe(1);
    expect(app.set).toHaveBeenCalledWith("trust proxy", 1);
  });
});
