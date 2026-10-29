import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CompetitionResultsStatusQueryDto,
  MAX_RESULTS_STATUS_IDS,
} from "./competition-results-status.dto";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const parse = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(CompetitionResultsStatusQueryDto, query);
  return { dto, errors: await validate(dto) };
};

describe("CompetitionResultsStatusQueryDto (#846)", () => {
  it("accepts a single id", async () => {
    const { dto, errors } = await parse({ ids: A });
    expect(errors).toEqual([]);
    expect(dto.ids).toEqual([A]);
  });

  it("accepts repeated and comma-separated ids, deduplicated", async () => {
    const { dto, errors } = await parse({ ids: [`${A}, ${B}`, A, " "] });
    expect(errors).toEqual([]);
    expect(dto.ids).toEqual([A, B]);
  });

  it("rejects a missing or empty list", async () => {
    expect((await parse({})).errors).not.toEqual([]);
    expect((await parse({ ids: "" })).errors).not.toEqual([]);
  });

  it("rejects an id that is not a UUID", async () => {
    expect((await parse({ ids: [A, "nope"] })).errors).not.toEqual([]);
  });

  it(`rejects more than ${MAX_RESULTS_STATUS_IDS} ids`, async () => {
    const ids = Array.from(
      { length: MAX_RESULTS_STATUS_IDS + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect((await parse({ ids })).errors).not.toEqual([]);
    expect((await parse({ ids: ids.slice(1) })).errors).toEqual([]);
  });
});
