import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ImportResultsDto, MAX_RESULTS_CSV_LENGTH } from "./results-import.dto";

async function errorsOf(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(ImportResultsDto, body));
  return errors.flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe("ImportResultsDto (#652)", () => {
  it("accepts a CSV text", async () => {
    expect(await errorsOf({ csv: "epreuve;tour;classement;couple" })).toEqual(
      [],
    );
  });

  it("refuses a missing, empty or non-string csv", async () => {
    expect(await errorsOf({})).toContain("isString");
    expect(await errorsOf({ csv: "" })).toContain("isNotEmpty");
    expect(await errorsOf({ csv: 42 })).toContain("isString");
  });

  it("refuses a text over the size cap", async () => {
    expect(
      await errorsOf({ csv: "x".repeat(MAX_RESULTS_CSV_LENGTH + 1) }),
    ).toContain("maxLength");
  });
});
