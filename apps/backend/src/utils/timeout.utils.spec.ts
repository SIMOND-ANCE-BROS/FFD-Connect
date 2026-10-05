import { withTimeout } from "./timeout.utils";

describe("withTimeout", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("rejects with timeout error when promise hangs", async () => {
    const hanging = new Promise<never>(() => {});
    const result = withTimeout(hanging, 5000, "test-label").catch((e) => e);
    await jest.runAllTimersAsync();
    const err = await result;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("[Timeout] test-label timed out after 5000ms");
  });

  it("resolves with the value when promise resolves before timeout", async () => {
    const fast = Promise.resolve("hello");
    const result = await withTimeout(fast, 5000, "test-label");
    expect(result).toBe("hello");
  });

  it("clears the timer when promise resolves early (no open handle)", async () => {
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    const fast = Promise.resolve("done");
    await withTimeout(fast, 5000, "test-label");
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
