import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CheckTracksDto, ImportTrackDto } from "./track-import.dto";

const SHA = "a".repeat(64);

describe("ImportTrackDto (multipart fields)", () => {
  const parse = (plain: Record<string, unknown>) =>
    plainToInstance(ImportTrackDto, plain);
  const errors = (plain: Record<string, unknown>) =>
    validateSync(parse(plain)).map((e) => e.property);
  const valid = {
    title: "In the Mood",
    artist: "Empress Orchestra",
    sha256: SHA,
  };

  it("accepts a track-prep row sent as strings", () => {
    const plain = {
      ...valid,
      style: "Jive",
      mpm: "42",
      rawBpm: "169.64",
      sourceKey: " apple:1091542189 ",
      sha256: "A".repeat(64),
    };
    expect(errors(plain)).toEqual([]);
    expect(parse(plain)).toMatchObject({
      style: "Jive",
      mpm: 42,
      rawBpm: 169.64,
      sourceKey: "apple:1091542189",
      sha256: SHA,
    });
  });

  it("treats empty optional fields as absent", () => {
    const plain = { ...valid, style: "", mpm: "", rawBpm: " ", sourceKey: "" };
    expect(errors(plain)).toEqual([]);
    expect(parse(plain)).toMatchObject({
      style: undefined,
      mpm: undefined,
      rawBpm: undefined,
      sourceKey: undefined,
    });
  });

  it("accepts « Ambiance » and every canonical dance, nothing else", () => {
    expect(errors({ ...valid, style: "Ambiance" })).toEqual([]);
    expect(errors({ ...valid, style: "Valse Viennoise" })).toEqual([]);
    expect(errors({ ...valid, style: "Valse" })).toEqual(["style"]);
    expect(errors({ ...valid, style: "rumba" })).toEqual(["style"]);
  });

  it.each([
    ["title", { title: "" }],
    ["title", { title: "x".repeat(201) }],
    ["artist", { artist: "   " }],
    ["mpm", { mpm: "0" }],
    ["mpm", { mpm: "401" }],
    ["mpm", { mpm: "42.5" }],
    ["rawBpm", { rawBpm: "abc" }],
    ["rawBpm", { rawBpm: "400.5" }],
    ["sourceKey", { sourceKey: "x".repeat(101) }],
    ["sha256", { sha256: "xyz" }],
    ["sha256", { sha256: "a".repeat(63) }],
  ])("refuses a bad %s", (property, override) => {
    expect(errors({ ...valid, ...override })).toEqual([property]);
  });
});

describe("CheckTracksDto", () => {
  const errors = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(CheckTracksDto, plain)).map((e) => e.property);

  it("accepts 1 to 200 items", () => {
    expect(errors({ items: [{ sha256: SHA, sourceKey: "apple:1" }] })).toEqual(
      [],
    );
    expect(
      errors({ items: Array.from({ length: 200 }, () => ({ sha256: SHA })) }),
    ).toEqual([]);
  });

  it("refuses an empty list, more than 200 items, or a bad item", () => {
    expect(errors({ items: [] })).toEqual(["items"]);
    expect(
      errors({ items: Array.from({ length: 201 }, () => ({ sha256: SHA })) }),
    ).toEqual(["items"]);
    expect(errors({ items: [{ sha256: "nope" }] })).toEqual(["items"]);
  });
});
