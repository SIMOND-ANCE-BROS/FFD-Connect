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
});
