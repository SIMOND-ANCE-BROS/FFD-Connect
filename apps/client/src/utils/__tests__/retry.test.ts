import { retry, retryAxios } from "../retry";

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

  it("retries on axios 408/429", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValue("ok");

    const result = await retry(fn, { initialDelay: 0 });
    expect(result).toBe("ok");
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

  it("does not retry on 4xx (except 408, 429)", async () => {
    const fn = jest.fn().mockRejectedValue({ response: { status: 404 } });

    await expect(retryAxios(fn, { initialDelay: 0 })).rejects.toEqual({
      response: { status: 404 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 408 and 429", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 408 } })
      .mockResolvedValue("ok");

    const result = await retryAxios(fn, { initialDelay: 0 });
    expect(result).toBe("ok");
  });
});
