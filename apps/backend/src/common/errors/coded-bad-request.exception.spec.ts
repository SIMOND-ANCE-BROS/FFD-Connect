import { BadRequestException, HttpStatus } from "@nestjs/common";
import {
  CodedBadRequestException,
  errorCodeOf,
  logCodeOf,
} from "./coded-bad-request.exception";

describe("CodedBadRequestException (#225)", () => {
  const USER_TEXT = "Texte destiné à l'utilisateur (SENTINEL-225)";

  it("answers the user text and the code in its body", () => {
    const error = new CodedBadRequestException("MEDICAL_UNFIT", USER_TEXT);
    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(error.getResponse()).toEqual({
      message: USER_TEXT,
      error: "Bad Request",
      statusCode: 400,
      code: "MEDICAL_UNFIT",
    });
    expect(error.code).toBe("MEDICAL_UNFIT");
  });

  it("keeps the user text out of Error.message and the stack trace", () => {
    const error = new CodedBadRequestException("MEDICAL_UNFIT", USER_TEXT);
    expect(error.message).toBe("MEDICAL_UNFIT");
    expect(error.stack).toBeDefined();
    expect(error.stack).not.toContain("SENTINEL-225");
  });
});

describe("errorCodeOf", () => {
  it("reads a non-empty string code", () => {
    expect(errorCodeOf({ code: "X" })).toBe("X");
  });

  it.each([null, "text", 42, {}, { code: "" }, { code: 3 }])(
    "ignores %p",
    (body) => {
      expect(errorCodeOf(body)).toBeUndefined();
    },
  );
});

describe("logCode", () => {
  it("defaults to the code", () => {
    const error = new CodedBadRequestException("SOME_CODE", "text");
    expect(error.logCode).toBe("SOME_CODE");
    expect(logCodeOf(error, error.getResponse())).toBe("SOME_CODE");
  });

  it("replaces the fine code everywhere the logs look", () => {
    const error = new CodedBadRequestException("FINE", "text", "NEUTRAL");
    expect(error.message).toBe("NEUTRAL");
    expect(error.stack).not.toContain("FINE");
    expect(logCodeOf(error, error.getResponse())).toBe("NEUTRAL");
    // The client still gets the fine code.
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ code: "FINE" }),
    );
  });

  it("falls back on the body code of any other exception", () => {
    const error = new BadRequestException({ message: "m", code: "BODY" });
    expect(logCodeOf(error, error.getResponse())).toBe("BODY");
    expect(logCodeOf(new Error("x"), null)).toBeUndefined();
  });
});
