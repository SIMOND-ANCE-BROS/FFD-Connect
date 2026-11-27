import { ForbiddenException } from "@nestjs/common";
import { WRONG_PASSWORD_CODE, wrongPasswordRefusal } from "./wrong-password";

describe("wrongPasswordRefusal (#937)", () => {
  it("is a 403, not a 401: the app must not take it for an expired token", () => {
    const refusal = wrongPasswordRefusal("Mot de passe incorrect");

    expect(refusal).toBeInstanceOf(ForbiddenException);
    expect(refusal.getStatus()).toBe(403);
  });

  it("carries the message and the WRONG_PASSWORD code", () => {
    expect(
      wrongPasswordRefusal("Mot de passe incorrect").getResponse(),
    ).toEqual({
      statusCode: 403,
      error: "Forbidden",
      message: "Mot de passe incorrect",
      code: WRONG_PASSWORD_CODE,
    });
    expect(WRONG_PASSWORD_CODE).toBe("WRONG_PASSWORD");
  });
});
