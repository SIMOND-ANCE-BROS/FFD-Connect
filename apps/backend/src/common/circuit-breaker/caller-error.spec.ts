import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { RestError } from "@azure/storage-blob";
import { AxiosError, AxiosHeaders } from "axios";
import {
  getErrorHttpStatus,
  isCallerError,
  isCallerErrorStatus,
} from "./caller-error";

const axiosError = (status?: number, data: unknown = null): AxiosError =>
  new AxiosError(
    status === undefined ? "Network Error" : `HTTP ${status}`,
    status === undefined ? "ECONNREFUSED" : "ERR_BAD_REQUEST",
    undefined,
    undefined,
    status === undefined
      ? undefined
      : {
          status,
          statusText: "",
          headers: {},
          config: { headers: new AxiosHeaders() },
          data,
        },
  );

const withFields = (fields: Record<string, unknown>): Error =>
  Object.assign(new Error("boom"), fields);

describe("caller-error (#437)", () => {
  describe("getErrorHttpStatus", () => {
    it("reads axios / Nest HttpService errors (response.status)", () => {
      expect(getErrorHttpStatus(axiosError(404))).toBe(404);
    });

    it("returns undefined for an axios error without response (network)", () => {
      expect(getErrorHttpStatus(axiosError())).toBeUndefined();
    });

    it("reads Azure SDK RestError (statusCode)", () => {
      expect(getErrorHttpStatus(new RestError("nf", { statusCode: 404 }))).toBe(
        404,
      );
    });

    it("reads an Error's own statusCode / status", () => {
      expect(getErrorHttpStatus(withFields({ statusCode: 409 }))).toBe(409);
      expect(getErrorHttpStatus(withFields({ status: 422 }))).toBe(422);
    });

    it("reads Nest HttpException statuses via getStatus()", () => {
      expect(getErrorHttpStatus(new NotFoundException())).toBe(404);
      expect(getErrorHttpStatus(new ServiceUnavailableException())).toBe(503);
    });

    // L3: a remote body must never decide the status.
    it("ignores a status inside an HttpException body", () => {
      const error = new ServiceUnavailableException({ status: 404 });
      expect(getErrorHttpStatus(error)).toBe(503);
    });

    it("ignores response.status on a non-axios error", () => {
      expect(
        getErrorHttpStatus(withFields({ response: { status: 404 } })),
      ).toBeUndefined();
    });

    it("uses the HTTP status of an axios error, not its body", () => {
      expect(getErrorHttpStatus(axiosError(503, { status: 404 }))).toBe(503);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a string", "boom"],
      ["a plain object with status", { status: 404 }],
      ["a plain Error", new Error("network")],
      ["a non-numeric status", withFields({ status: "404" })],
    ])("returns undefined for %s", (_label, error) => {
      expect(getErrorHttpStatus(error)).toBeUndefined();
    });
  });

  describe("isCallerErrorStatus", () => {
    it.each([400, 404, 409, 413, 422, 499])("%i is a caller error", (status) =>
      expect(isCallerErrorStatus(status)).toBe(true),
    );

    it.each([200, 302, 399, 401, 403, 408, 429, 500, 502, 503, 504])(
      "%i is not a caller error by default",
      (status) => expect(isCallerErrorStatus(status)).toBe(false),
    );

    it.each([401, 403])(
      "%i is a caller error only with ignoreAuthErrors",
      (status) =>
        expect(isCallerErrorStatus(status, { ignoreAuthErrors: true })).toBe(
          true,
        ),
    );

    it.each([408, 429, 500])(
      "%i stays an outage even with ignoreAuthErrors",
      (status) =>
        expect(isCallerErrorStatus(status, { ignoreAuthErrors: true })).toBe(
          false,
        ),
    );
  });

  describe("isCallerError", () => {
    it("filters remote 4xx answers", () => {
      expect(isCallerError(axiosError(404))).toBe(true);
      expect(isCallerError(new RestError("x", { statusCode: 400 }))).toBe(true);
    });

    it("counts 5xx, 408 and 429", () => {
      expect(isCallerError(axiosError(500))).toBe(false);
      expect(isCallerError(withFields({ statusCode: 408 }))).toBe(false);
      expect(isCallerError(withFields({ status: 429 }))).toBe(false);
    });

    it("counts 401/403 (global credentials) unless opted in", () => {
      expect(isCallerError(axiosError(401))).toBe(false);
      expect(isCallerError(new UnauthorizedException())).toBe(false);
      expect(isCallerError(axiosError(403), { ignoreAuthErrors: true })).toBe(
        true,
      );
    });

    it("counts timeouts and network errors", () => {
      expect(isCallerError(new Error("[Timeout] x timed out after 1ms"))).toBe(
        false,
      );
      expect(isCallerError(axiosError())).toBe(false);
      expect(isCallerError(undefined)).toBe(false);
      expect(isCallerError({ code: "messaging/invalid-argument" })).toBe(false);
    });

    it.each([
      "messaging/invalid-argument",
      "messaging/registration-token-not-registered",
      "messaging/invalid-registration-token",
    ])("filters the FCM caller error %s", (code) => {
      expect(isCallerError(withFields({ code }))).toBe(true);
    });

    it.each([
      "messaging/mismatched-credential",
      "messaging/server-unavailable",
      "messaging/internal-error",
      "messaging/message-rate-exceeded",
      "messaging/third-party-auth-error",
    ])("counts the FCM outage %s", (code) => {
      expect(isCallerError(withFields({ code }))).toBe(false);
    });
  });
});
