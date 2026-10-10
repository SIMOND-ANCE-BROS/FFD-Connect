import { HttpStatus } from "@nestjs/common";
import {
  CodedBadRequestException,
  errorCodeOf,
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
