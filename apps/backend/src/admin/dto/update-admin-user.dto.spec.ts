import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateAdminUserDto } from "./update-admin-user.dto";

describe("UpdateAdminUserDto", () => {
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(UpdateAdminUserDto, body))).map(
      (e) => e.property,
    );

  it("accepts null to clear nullable fields", async () => {
    expect(
      await errorsOf({ clubId: null, category: null, nationalRanking: null }),
    ).toEqual([]);
  });

  it("rejects values outside the reference lists", async () => {
    expect(
      await errorsOf({ category: "Latine", ageGroup: "Vieux", role: "ROOT" }),
    ).toEqual(["category", "ageGroup", "role"]);
  });

  it.each(["firstName", "lastName", "role"])(
    "rejects null on required field %s",
    async (field) => {
      expect(await errorsOf({ [field]: null })).toEqual([field]);
    },
  );

  it("accepts a list of known roles and rejects an unknown one", async () => {
    expect(await errorsOf({ extraRoles: ["CLUB", "STAFF"] })).toEqual([]);
    expect(await errorsOf({ extraRoles: ["ROOT"] })).toContain("extraRoles");
    expect(await errorsOf({ extraRoles: "CLUB" })).toContain("extraRoles");
    expect(await errorsOf({ extraRoles: ["CLUB", "CLUB"] })).toContain(
      "extraRoles",
    );
    expect(await errorsOf({ extraRoles: null })).toContain("extraRoles");
  });

  it("accepts an empty body", async () => {
    expect(await errorsOf({})).toEqual([]);
  });
});
