import {
  parseRetryAfter,
  retry,
  retryAxios,
  RETRY_AFTER_MAX_MS,
} from "../retry";

describe("retry util", () => {
  it("returns result when first attempt succeeds", async () => {
    const fn = jest.fn().mockResolvedValue("success");
    const result = await retry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds eventually", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("Fail"))
      .mockRejectedValueOnce(new Error("Fail"))
      .mockResolvedValue("success");

    const result = await retry(fn, { initialDelay: 0, maxRetries: 3 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("fails after max retries", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("Permanent Fail"));
    await expect(retry(fn, { initialDelay: 0, maxRetries: 2 })).rejects.toThrow(
      "Permanent Fail",
    );
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it("does not retry on 4xx (default shouldRetry)", async () => {
    const fn = jest.fn().mockRejectedValue({ response: { status: 400 } });
    await expect(retry(fn, { initialDelay: 0 })).rejects.toEqual({
      response: { status: 400 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry if shouldRetry returns false", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("No retry"));
    const shouldRetry = jest.fn().mockReturnValue(false);

    await expect(retry(fn, { shouldRetry, initialDelay: 0 })).rejects.toThrow(
      "No retry",
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalled();
  });

  it("retries on axios 5xx error", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValue("ok");

    const result = await retry(fn, { initialDelay: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on axios 408", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 408 } })
      .mockResolvedValue("ok");

    const result = await retry(fn, { initialDelay: 0 });
    expect(result).toBe("ok");
  });

  it("does not blindly retry an axios 429 (#585)", async () => {
    const fn = jest.fn().mockRejectedValue({ response: { status: 429 } });
    await expect(retry(fn, { initialDelay: 0 })).rejects.toEqual({
      response: { status: 429 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not blindly retry an HttpError 429 (#585)", async () => {
    const fn = jest.fn().mockRejectedValue({ statusCode: 429 });
    await expect(retry(fn, { initialDelay: 0 })).rejects.toEqual({
      statusCode: 429,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on network error (no response)", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValue("ok");

    const result = await retry(fn, { initialDelay: 0 });
    expect(result).toBe("ok");
  });

  it("retries on HttpError statusCode 500", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ statusCode: 500 })
      .mockResolvedValue("ok");

    const result = await retry(fn, { initialDelay: 0 });
    expect(result).toBe("ok");
  });

  it("retries on TypeError with fetch in message (network failure)", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("ok");

    const result = await retry(fn, { initialDelay: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("retryAxios", () => {
  it("returns result when first attempt succeeds", async () => {
    const fn = jest.fn().mockResolvedValue({ data: "success" });
    const result = await retryAxios(fn);
    expect(result).toEqual({ data: "success" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx and succeeds", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValue({ data: "ok" });

    const result = await retryAxios(fn, { initialDelay: 0 });
    expect((result as { data: string }).data).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx (except 408)", async () => {
    const fn = jest.fn().mockRejectedValue({ response: { status: 404 } });

    await expect(retryAxios(fn, { initialDelay: 0 })).rejects.toEqual({
      response: { status: 404 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 408", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 408 } })
      .mockResolvedValue("ok");

    const result = await retryAxios(fn, { initialDelay: 0 });
    expect(result).toBe("ok");
  });

  it("does not retry on 429 — handled once with Retry-After by api.ts", async () => {
    const fn = jest.fn().mockRejectedValue({ response: { status: 429 } });

    await expect(retryAxios(fn, { initialDelay: 0 })).rejects.toEqual({
      response: { status: 429 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("parseRetryAfter (#585)", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");

  it("parses delta-seconds", () => {
    expect(parseRetryAfter("3", now)).toBe(3000);
    expect(parseRetryAfter(" 0 ", now)).toBe(0);
    expect(parseRetryAfter("1.5", now)).toBe(1500);
  });

  it("accepts a numeric value and an array of values", () => {
    expect(parseRetryAfter(2, now)).toBe(2000);
    expect(parseRetryAfter(["4"], now)).toBe(4000);
  });

  it("parses an HTTP-date relative to now", () => {
    expect(parseRetryAfter("Wed, 14 Oct 2026 10:00:05 GMT", now)).toBe(5000);
  });

  it("clamps a past HTTP-date to 0", () => {
    expect(parseRetryAfter("Wed, 14 Oct 2026 09:59:00 GMT", now)).toBe(0);
  });

  it("returns null when absent or invalid", () => {
    expect(parseRetryAfter(undefined, now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(-1, now)).toBeNull();
    expect(parseRetryAfter(Number.NaN, now)).toBeNull();
    expect(parseRetryAfter({}, now)).toBeNull();
  });

  it("caps the accepted wait at 10 s", () => {
    expect(RETRY_AFTER_MAX_MS).toBe(10_000);
  });
});
