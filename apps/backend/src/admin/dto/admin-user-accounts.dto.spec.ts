import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateAdminUserDto } from "./admin-user-accounts.dto";

describe("CreateAdminUserDto", () => {
  const base = { email: "a@b.fr", firstName: "A", lastName: "B" };
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(CreateAdminUserDto, body))).map(
      (e) => e.property,
    );

  it.each(["LICENSEE", "CLUB", "STAFF"])("accepts role %s", async (role) => {
    expect(await errorsOf({ ...base, role })).toEqual([]);
  });

  it("never accepts ADMIN", async () => {
    expect(await errorsOf({ ...base, role: "ADMIN" })).toEqual(["role"]);
  });

  it("validates optional profile fields against the reference lists", async () => {
    expect(
      await errorsOf({
        ...base,
        role: "LICENSEE",
        category: "Latin",
        nationalRanking: 12,
      }),
    ).toEqual([]);
    expect(
      await errorsOf({ ...base, role: "LICENSEE", category: "Latine" }),
    ).toEqual(["category"]);
  });
});
