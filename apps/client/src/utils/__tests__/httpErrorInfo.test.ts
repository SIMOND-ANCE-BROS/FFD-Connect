import {
  getHttpErrorInfo,
  httpFingerprint,
  isExpectedHttpStatus,
  normalizeRoute,
} from "../httpErrorInfo";

const axiosError = (
  status: number | undefined,
  url = "/tracks/42",
  method = "get",
): Error =>
  Object.assign(new Error("Request failed"), {
    name: "AxiosError",
    isAxiosError: true,
    response: status === undefined ? undefined : { status },
    config: { url, method },
  });

describe("normalizeRoute (#585)", () => {
  it("strips origin, query and hash", () => {
    expect(normalizeRoute("https://api.example.com/tracks?q=salsa#x")).toBe(
      "/tracks",
    );
  });

  it("replaces numeric, uuid, cuid and hex ids", () => {
    expect(normalizeRoute("/tracks/42")).toBe("/tracks/:id");
    expect(
      normalizeRoute("/clubs/3f2504e0-4f89-11d3-9a0c-0305e82c3301/members"),
    ).toBe("/clubs/:id/members");
    expect(normalizeRoute("/users/cjld2cjxh0000qzrmn831i7rn")).toBe(
      "/users/:id",
    );
    expect(normalizeRoute("/files/5f8d0d55b54764421b7156c3")).toBe(
      "/files/:id",
    );
  });

  it("replaces long opaque tokens mixing letters and digits", () => {
    expect(normalizeRoute("/licenses/FFD2026AB12345")).toBe("/licenses/:id");
  });

  it("keeps plain words", () => {
    expect(normalizeRoute("/notifications/preferences")).toBe(
      "/notifications/preferences",
    );
  });

  it("handles missing and root urls", () => {
    expect(normalizeRoute(undefined)).toBe("unknown");
    expect(normalizeRoute("/")).toBe("/");
  });
});

describe("getHttpErrorInfo", () => {
  it("reads status, method and route from an AxiosError", () => {
    expect(getHttpErrorInfo(axiosError(429, "/tracks/42?x=1", "post"))).toEqual(
      { status: 429, method: "POST", route: "/tracks/:id" },
    );
  });

  it("reports a network error as an undefined status", () => {
    expect(getHttpErrorInfo(axiosError(undefined))?.status).toBeUndefined();
  });

  it("defaults the method when the config is missing", () => {
    const err = Object.assign(new Error("x"), { isAxiosError: true });
    expect(getHttpErrorInfo(err)).toEqual({
      status: undefined,
      method: "UNKNOWN",
      route: "unknown",
    });
  });

  it("reads an HttpError from httpInterceptor", () => {
    const err = Object.assign(new Error("HTTP 404"), {
      name: "HttpError",
      statusCode: 404,
    });
    expect(getHttpErrorInfo(err)?.status).toBe(404);
    const net = Object.assign(new Error("HTTP 0"), {
      name: "HttpError",
      statusCode: 0,
    });
    expect(getHttpErrorInfo(net)?.status).toBeUndefined();
  });

  it("returns null for non-HTTP errors", () => {
    expect(getHttpErrorInfo(new Error("boom"))).toBeNull();
    expect(getHttpErrorInfo(undefined)).toBeNull();
    expect(getHttpErrorInfo("oops")).toBeNull();
  });
});

describe("isExpectedHttpStatus", () => {
  it.each([401, 403, 404, 408, 409, 410, 429])("%i is expected", (s) => {
    expect(isExpectedHttpStatus(s)).toBe(true);
  });

  it.each([400, 405, 413, 415, 422, 500, 503])(
    "%i is not expected (bug or server failure)",
    (s) => {
      expect(isExpectedHttpStatus(s)).toBe(false);
    },
  );

  it("a network error is not an expected 4xx", () => {
    expect(isExpectedHttpStatus(undefined)).toBe(false);
  });
});

describe("httpFingerprint", () => {
  it("differs by status for the same route", () => {
    const a = httpFingerprint({ status: 401, method: "GET", route: "/x" });
    const b = httpFingerprint({ status: 429, method: "GET", route: "/x" });
    expect(a).not.toEqual(b);
    expect(a).toEqual(["http-error", "401", "GET", "/x"]);
  });

  it("labels network errors", () => {
    expect(
      httpFingerprint({ status: undefined, method: "GET", route: "/x" })[1],
    ).toBe("network");
  });
});
