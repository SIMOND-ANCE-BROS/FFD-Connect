import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateAdminClubDto } from "./admin-clubs.dto";

describe("CreateAdminClubDto", () => {
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(CreateAdminClubDto, body))).map(
      (e) => e.property,
    );

  it("accepts a name, with or without a registration mode", async () => {
    expect(await errorsOf({ name: "Club A" })).toEqual([]);
    expect(
      await errorsOf({ name: "Club A", registrationMode: "CLUB_ONLY" }),
    ).toEqual([]);
  });

  it("trims the name before validating its length", async () => {
    const dto = plainToInstance(CreateAdminClubDto, { name: "  Club A  " });
    expect(dto.name).toBe("Club A");
    expect(await errorsOf({ name: "   " })).toEqual(["name"]);
  });

  it("requires a name of 2 to 120 characters", async () => {
    expect(await errorsOf({})).toEqual(["name"]);
    expect(await errorsOf({ name: "A" })).toEqual(["name"]);
    expect(await errorsOf({ name: "AB" })).toEqual([]);
    expect(await errorsOf({ name: "a".repeat(120) })).toEqual([]);
    expect(await errorsOf({ name: "a".repeat(121) })).toEqual(["name"]);
    expect(await errorsOf({ name: 12 })).toEqual(["name"]);
  });

  it("rejects an unknown registration mode", async () => {
    expect(await errorsOf({ name: "A", registrationMode: "NOPE" })).toEqual([
      "registrationMode",
    ]);
  });
});
