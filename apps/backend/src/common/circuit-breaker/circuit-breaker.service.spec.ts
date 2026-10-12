import { ServiceUnavailableException } from "@nestjs/common";
import {
  CircuitBreakerService,
  MAX_SCOPED_BREAKERS,
} from "./circuit-breaker.service";

describe("CircuitBreakerService", () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
  });

  it("executes the function and returns its result when closed", async () => {
    const result = await service.fire("azure-vision", () =>
      Promise.resolve("ok"),
    );
    expect(result).toBe("ok");
  });

  it("propagates errors from the wrapped function", async () => {
    await expect(
      service.fire("azure-tts", () => Promise.reject(new Error("TTS down"))),
    ).rejects.toThrow("TTS down");
  });

  it("opens the breaker after volumeThreshold failures", async () => {
    // Force 5+ failures to trip the breaker (volumeThreshold = 5, errorThreshold = 50%)
    for (let i = 0; i < 10; i++) {
      await service
        .fire("wdsf", () => Promise.reject(new Error("WDSF unavailable")))
        .catch(() => {});
    }
    // Next call should be rejected immediately with 503
    await expect(
      service.fire("wdsf", () => Promise.resolve("should not run")),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("throws ServiceUnavailableException (not the original error) when open", async () => {
    for (let i = 0; i < 10; i++) {
      await service
        .fire("azure-vision", () => Promise.reject(new Error("Vision down")))
        .catch(() => {});
    }
    await expect(
      service.fire("azure-vision", () => Promise.resolve("x")),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  describe("scoped breakers (#404)", () => {
    const fail = () => Promise.reject(new Error("down"));

    it("counts failures per scope: one tenant cannot open another's breaker", async () => {
      for (let i = 0; i < 5; i++) {
        await service.fire("helloasso", fail, "club-a").catch(() => undefined);
      }

      await expect(
        service.fire("helloasso", fail, "club-a"),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        service.fire("helloasso", () => Promise.resolve("ok"), "club-b"),
      ).resolves.toBe("ok");
      await expect(
        service.fire("helloasso", () => Promise.resolve("ok")),
      ).resolves.toBe("ok");
    });

    it("bounds the number of scoped breakers kept in memory", async () => {
      for (let i = 0; i <= MAX_SCOPED_BREAKERS; i++) {
        await service.fire("helloasso", () => Promise.resolve(i), `org-${i}`);
      }

      const breakers = (
        service as unknown as { breakers: Map<string, unknown> }
      ).breakers;
      expect(breakers.size).toBeLessThanOrEqual(MAX_SCOPED_BREAKERS);
      expect(breakers.has("helloasso:org-0")).toBe(false);
    });
  });
});
