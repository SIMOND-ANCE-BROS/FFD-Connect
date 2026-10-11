import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { ListAdminTracksQueryDto } from "./admin-track.dto";

describe("ListAdminTracksQueryDto", () => {
  const parse = (plain: Record<string, unknown>) =>
    plainToInstance(ListAdminTracksQueryDto, plain);
  const errors = (plain: Record<string, unknown>) =>
    validateSync(parse(plain)).map((e) => e.property);

  it('reads only the strings true and false as booleans, "false" included', () => {
    const dto = parse({
      blacklisted: "false",
      titleMasked: "true",
      ambiance: "false",
    });
    expect(dto).toMatchObject({
      blacklisted: false,
      titleMasked: true,
      ambiance: false,
    });
    expect(
      errors({ blacklisted: "false", titleMasked: "true", ambiance: "false" }),
    ).toEqual([]);
  });

  it.each(["yes", "1", "", "TRUE"])("refuses the flag value %p", (value) => {
    expect(errors({ blacklisted: value })).toEqual(["blacklisted"]);
  });

  it("trims the search, then requires 2 to 100 characters", () => {
    expect(parse({ q: "  pa  " }).q).toBe("pa");
    expect(errors({ q: "  pa  " })).toEqual([]);
    expect(errors({ q: " p " })).toEqual(["q"]);
    expect(errors({ q: "x".repeat(101) })).toEqual(["q"]);
  });

  it("accepts the three statuses only", () => {
    expect(errors({ status: "ERROR" })).toEqual([]);
    expect(errors({ status: "DONE" })).toEqual(["status"]);
  });

  it("trims the dance and bounds it", () => {
    expect(parse({ style: " Rumba " }).style).toBe("Rumba");
    expect(errors({ style: "x".repeat(65) })).toEqual(["style"]);
    expect(errors({ style: "  " })).toEqual(["style"]);
  });

  it("keeps the pagination bounds", () => {
    expect(errors({ take: "100" })).toEqual([]);
    expect(errors({ take: "101" })).toEqual(["take"]);
  });
});
