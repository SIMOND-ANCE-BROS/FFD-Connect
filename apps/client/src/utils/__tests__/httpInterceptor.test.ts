import {
  httpRequest,
  httpGet,
  httpPost,
  httpPut,
  httpDelete,
  HttpError,
} from "../httpInterceptor";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

function mockFetch(response: Partial<Response> & { ok: boolean }) {
  global.fetch = jest.fn().mockResolvedValue(response);
}

function mockFetchError(error: Error) {
  global.fetch = jest.fn().mockRejectedValue(error);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(global, "clearTimeout");
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// HttpError class
// ---------------------------------------------------------------------------
describe("HttpError", () => {
  it("constructs with status and statusText", () => {
    const err = new HttpError(404, "Not Found");
    expect(err.statusCode).toBe(404);
    expect(err.statusText).toBe("Not Found");
    expect(err.message).toBe("HTTP 404: Not Found");
    expect(err.name).toBe("HttpError");
  });

  it("uses custom message when provided", () => {
    const err = new HttpError(500, "Server Error", null, "Custom message");
    expect(err.message).toBe("Custom message");
  });

  it("stores error data", () => {
    const data = { message: "Bad request" };
    const err = new HttpError(400, "Bad Request", data);
    expect(err.data).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// httpRequest — successful responses
// ---------------------------------------------------------------------------
describe("httpRequest — success", () => {
  it("parses JSON when content-type is application/json", async () => {
    mockFetch({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: jest.fn().mockResolvedValue({ id: 1 }),
    });

    const result = await httpRequest("/api/users");
    expect(result).toEqual({ id: 1 });
  });

  it("returns text when content-type is not JSON", async () => {
    mockFetch({
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: jest.fn().mockResolvedValue("hello"),
    });

    const result = await httpRequest("/api/text");
    expect(result).toBe("hello");
  });

  it("clears timeout after successful request", async () => {
    mockFetch({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: jest.fn().mockResolvedValue({}),
    });

    await httpRequest("/api/data", { timeout: 5000 });
    expect(clearTimeout).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// httpRequest — HTTP errors
// ---------------------------------------------------------------------------
describe("httpRequest — HTTP errors", () => {
  it("throws HttpError for non-ok responses with JSON body", async () => {
    mockFetch({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: new Headers(),
      json: jest.fn().mockResolvedValue({ message: "Invalid input" }),
      text: jest.fn(),
    });

    await expect(httpRequest("/api/users")).rejects.toThrow(HttpError);
    await expect(httpRequest("/api/users")).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid input",
    });
  });

  it("throws HttpError with text body when JSON parse fails", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      json: jest.fn().mockRejectedValue(new Error("not JSON")),
      text: jest.fn().mockResolvedValue("Server exploded"),
    });

    const err = await httpRequest("/api/users").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(500);
    expect(err.data).toBe("Server exploded");
  });

  it("uses errorMessage option when server provides no message", async () => {
    mockFetch({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: new Headers(),
      json: jest.fn().mockResolvedValue({}),
      text: jest.fn(),
    });

    const err = await httpRequest("/api/admin", {
      errorMessage: "Custom forbidden message",
    }).catch((e) => e);
    expect(err.message).toBe("Custom forbidden message");
  });

  it("uses getErrorMessage fallback for known status codes", async () => {
    const cases: [number, string][] = [
      [401, ERROR_MESSAGES.INVALID_CREDENTIALS],
      [403, "Accès refusé"],
      [404, "Ressource non trouvée"],
    ];

    for (const [status, expectedMsg] of cases) {
      mockFetch({
        ok: false,
        status,
        statusText: "Error",
        headers: new Headers(),
        json: jest.fn().mockResolvedValue({}),
        text: jest.fn(),
      });

      const err = await httpRequest("/api/resource").catch((e) => e);
      expect(err.message).toBe(expectedMsg);
    }
  });

  it("still throws HttpError when logErrors is false", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Server Error",
      headers: new Headers(),
      json: jest.fn().mockResolvedValue({}),
      text: jest.fn(),
    });

    await expect(
      httpRequest("/api/data", { logErrors: false }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});

// ---------------------------------------------------------------------------
// httpRequest — network / abort errors
// ---------------------------------------------------------------------------
describe("httpRequest — network errors", () => {
  it("throws HttpError(408) on timeout (AbortError)", async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const promise = httpRequest("/api/slow", { timeout: 1000 });
    jest.runAllTimers();

    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(408);
    expect(err.message).toBe(ERROR_MESSAGES.TIMEOUT_ERROR);
  });

  it("throws HttpError(0) on fetch TypeError (network error)", async () => {
    mockFetchError(new TypeError("Failed to fetch"));

    const err = await httpRequest("/api/down").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(0);
    expect(err.message).toBe(ERROR_MESSAGES.NETWORK_ERROR);
  });

  it("re-throws HttpError without wrapping", async () => {
    const original = new HttpError(
      422,
      "Unprocessable",
      null,
      "Validation failed",
    );
    global.fetch = jest.fn().mockRejectedValue(original);

    const err = await httpRequest("/api/form").catch((e) => e);
    expect(err).toBe(original);
  });

  it("wraps unknown errors in HttpError(500)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Unexpected"));

    const err = await httpRequest("/api/boom").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// httpRequest — retry
// ---------------------------------------------------------------------------
describe("httpRequest — retry", () => {
  it("retries on 500 when retry: true", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Headers(),
        json: jest.fn().mockResolvedValue({}),
        text: jest.fn(),
      })
      .mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

    const promise = httpRequest("/api/flaky", { retry: true });
    // advance timers to bypass retry delay
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries with custom RetryOptions", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers(),
        json: jest.fn().mockResolvedValue({}),
        text: jest.fn(),
      })
      .mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: jest.fn().mockResolvedValue({ data: "ok" }),
      });

    const promise = httpRequest("/api/service", {
      retry: { maxRetries: 2, initialDelay: 0 },
    });
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ data: "ok" });
  });

  it("does not retry when retry option is not set", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Server Error",
      headers: new Headers(),
      json: jest.fn().mockResolvedValue({}),
      text: jest.fn(),
    });

    await expect(httpRequest("/api/noretry")).rejects.toBeInstanceOf(HttpError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Helper methods: httpGet, httpPost, httpPut, httpDelete
// ---------------------------------------------------------------------------
describe("HTTP helper methods", () => {
  beforeEach(() => {
    mockFetch({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: jest.fn().mockResolvedValue({ success: true }),
    });
  });

  it("httpGet sends GET request", async () => {
    await httpGet("/api/items");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/items",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("httpPost sends POST with JSON body", async () => {
    await httpPost("/api/items", { name: "test" });
    const call = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(call.method).toBe("POST");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.body).toBe(JSON.stringify({ name: "test" }));
  });

  it("httpPost sends POST without body when data is undefined", async () => {
    await httpPost("/api/items");
    const call = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(call.body).toBeUndefined();
  });

  it("httpPut sends PUT with JSON body", async () => {
    await httpPut("/api/items/1", { name: "updated" });
    const call = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(call.method).toBe("PUT");
    expect(call.body).toBe(JSON.stringify({ name: "updated" }));
  });

  it("httpDelete sends DELETE request", async () => {
    await httpDelete("/api/items/1");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/items/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
