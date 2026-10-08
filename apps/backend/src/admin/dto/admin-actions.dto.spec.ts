import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DeleteAdminUserDto } from "./admin-actions.dto";

describe("DeleteAdminUserDto", () => {
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(DeleteAdminUserDto, body))).map(
      (e) => e.property,
    );

  it("accepts a legacy email that is not RFC-valid: the service compares it", async () => {
    expect(await errorsOf({ confirmEmail: "jean..dupont@club" })).toEqual([]);
  });

  it("trims the confirmation", () => {
    expect(
      plainToInstance(DeleteAdminUserDto, { confirmEmail: " a@b.fr " })
        .confirmEmail,
    ).toBe("a@b.fr");
  });

  it.each([
    ["a missing value", {}],
    ["a non-string value", { confirmEmail: 42 }],
    [
      "a value over 254 characters",
      { confirmEmail: `${"a".repeat(250)}@b.fr` },
    ],
  ])("rejects %s", async (_l, body) => {
    expect(await errorsOf(body)).toEqual(["confirmEmail"]);
  });
});
