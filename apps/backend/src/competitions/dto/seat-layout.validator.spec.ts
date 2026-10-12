import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateCompetitionDto,
  UpdateCompetitionDto,
} from "./competition-management.dto";
import { MAX_LAYOUT_ITEMS } from "./seat-layout.validator";

const layoutErrors = async (layout: unknown) => {
  const dto = plainToInstance(UpdateCompetitionDto, { layout });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.filter((e) => e.property === "layout");
};

describe("IsSeatLayout (#381)", () => {
  it("accepts the club editor's layout items as-is (no price)", async () => {
    const layout = [
      {
        id: "abc123",
        type: "GRADIN",
        label: "Gradin Nord",
        capacity: 40,
        x: 12.5,
        y: 40,
        width: 20,
        height: 10,
        rows: 4,
        cols: 10,
        lockedSeats: [1, 2],
        orientation: "horizontal",
        rotationDeg: 0,
        anyFutureField: true,
      },
    ];
    expect(await layoutErrors(layout)).toHaveLength(0);

    const dto = plainToInstance(UpdateCompetitionDto, { layout });
    expect(dto.layout).toEqual(layout); // free-form fields pass through
  });

  it.each([1, 1500, 1_000_000])("accepts priceCents %p", async (price) => {
    expect(await layoutErrors([{ id: "t1", priceCents: price }])).toHaveLength(
      0,
    );
  });

  it("accepts an empty layout and a missing id", async () => {
    expect(await layoutErrors([])).toHaveLength(0);
    expect(await layoutErrors([{ type: "TABLE" }])).toHaveLength(0);
  });

  it.each([
    ["zero", 0],
    ["negative", -100],
    ["decimal", 15.5],
    ["string", "1500"],
    ["null", null],
    ["too high", 1_000_001],
  ])("rejects a %s priceCents", async (_label, price) => {
    const errors = await layoutErrors([
      { id: "ok", priceCents: 100 },
      { id: "t1", priceCents: price },
    ]);
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})[0]).toMatch(
      /layout\[1\]\.priceCents/,
    );
  });

  it.each([
    ["not an array", { id: "t1" }, /must be an array/],
    ["an element that is not an object", ["t1"], /layout\[0\] must be/],
    ["an element that is an array", [[1]], /layout\[0\] must be/],
    ["a non-string id", [{ id: 42 }], /layout\[0\]\.id/],
    [
      "too many elements",
      Array.from({ length: MAX_LAYOUT_ITEMS + 1 }, () => ({})),
      /at most/,
    ],
  ])("rejects %s", async (_label, layout, message) => {
    const errors = await layoutErrors(layout);
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})[0]).toMatch(message);
  });

  it("validates the layout on creation too", async () => {
    const dto = plainToInstance(CreateCompetitionDto, {
      title: "T",
      date: "2026-06-01T10:00:00Z",
      location: "L",
      layout: [{ id: "t1", priceCents: 0 }],
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(["layout"]);
  });
});
