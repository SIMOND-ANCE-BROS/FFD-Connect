import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateAdminUserIdentifiersDto } from "./admin-user-identifiers.dto";

describe("UpdateAdminUserIdentifiersDto", () => {
  const parse = (body: object) =>
    plainToInstance(UpdateAdminUserIdentifiersDto, body);
  const errorsOf = async (body: object) =>
    (await validate(parse(body))).map((e) => e.property);

  it("normalises the email: trimmed and lower-cased", async () => {
    const dto = parse({ email: "  Jeanne.Martin@Example.FR " });
    expect(dto.email).toBe("jeanne.martin@example.fr");
    expect(await validate(dto)).toEqual([]);
  });

  it("trims the licence number without changing its case", () => {
    expect(parse({ licenseNumber: "  ffd-12 " }).licenseNumber).toBe("ffd-12");
  });

  it("accepts an empty body (the service asks for at least one field)", async () => {
    expect(await errorsOf({})).toEqual([]);
  });

  it.each([
    ["not-an-email"],
    ["a@b"],
    [`${"a".repeat(250)}@x.fr`],
    [""],
    [null],
    [42],
  ])("rejects the email %p", async (email) => {
    expect(await errorsOf({ email })).toEqual(["email"]);
  });

  it.each([["   "], ["-FFD"], ["FFD<1>"], ["1".repeat(33)], [null], [7]])(
    "rejects the licence number %p",
    async (licenseNumber) => {
      expect(await errorsOf({ licenseNumber })).toEqual(["licenseNumber"]);
    },
  );

  it("accepts a well-formed licence number", async () => {
    expect(await errorsOf({ licenseNumber: "FFD-2026/12.A" })).toEqual([]);
  });
});
