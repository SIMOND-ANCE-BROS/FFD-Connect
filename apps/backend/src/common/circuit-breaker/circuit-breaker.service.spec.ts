import { ServiceUnavailableException } from "@nestjs/common";
import { CircuitBreakerService } from "./circuit-breaker.service";

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
});
