import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  getErrorHttpStatus,
  isCallerError,
  isCallerErrorStatus,
} from "./caller-error";

describe("caller-error (#437)", () => {
  describe("getErrorHttpStatus", () => {
    it("reads axios / Nest HttpService errors (response.status)", () => {
      expect(getErrorHttpStatus({ response: { status: 404 } })).toBe(404);
    });

    it("reads Azure SDK RestError and Resend errors (statusCode)", () => {
      expect(getErrorHttpStatus({ statusCode: 409 })).toBe(409);
    });

    it("reads a plain status property", () => {
      expect(getErrorHttpStatus({ status: 422 })).toBe(422);
    });

    it("reads Nest HttpException statuses", () => {
      expect(getErrorHttpStatus(new NotFoundException())).toBe(404);
      expect(getErrorHttpStatus(new ServiceUnavailableException())).toBe(503);
    });

    it("prefers response.status over other fields", () => {
      expect(
        getErrorHttpStatus({ response: { status: 502 }, status: 400 }),
      ).toBe(502);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a string", "boom"],
      ["a plain Error", new Error("network")],
      ["a non-numeric status", { status: "404" }],
      ["a response without status", { response: {} }],
      ["a non-numeric getStatus", { getStatus: () => "x" }],
    ])("returns undefined for %s", (_label, error) => {
      expect(getErrorHttpStatus(error)).toBeUndefined();
    });
  });

  describe("isCallerErrorStatus", () => {
    it.each([400, 401, 403, 404, 409, 413, 422, 499])(
      "%i is a caller error",
      (status) => expect(isCallerErrorStatus(status)).toBe(true),
    );

    it.each([200, 302, 399, 408, 429, 500, 502, 503, 504])(
      "%i is not a caller error",
      (status) => expect(isCallerErrorStatus(status)).toBe(false),
    );
  });

  describe("isCallerError", () => {
    it("filters remote 4xx answers", () => {
      expect(isCallerError({ response: { status: 404 } })).toBe(true);
      expect(isCallerError({ statusCode: 400 })).toBe(true);
    });

    it("counts 5xx, 408 and 429", () => {
      expect(isCallerError({ response: { status: 500 } })).toBe(false);
      expect(isCallerError({ statusCode: 408 })).toBe(false);
      expect(isCallerError({ status: 429 })).toBe(false);
    });

    it("counts timeouts and network errors", () => {
      expect(isCallerError(new Error("[Timeout] x timed out after 1ms"))).toBe(
        false,
      );
      expect(
        isCallerError(
          Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
        ),
      ).toBe(false);
      expect(isCallerError(undefined)).toBe(false);
    });

    it.each([
      "messaging/invalid-argument",
      "messaging/registration-token-not-registered",
      "messaging/invalid-registration-token",
      "messaging/mismatched-credential",
    ])("filters the FCM caller error %s", (code) => {
      expect(isCallerError({ code })).toBe(true);
    });

    it.each([
      "messaging/server-unavailable",
      "messaging/internal-error",
      "messaging/message-rate-exceeded",
      "messaging/third-party-auth-error",
    ])("counts the FCM outage %s", (code) => {
      expect(isCallerError({ code })).toBe(false);
    });
  });
});
