import ffdConfig from "./ffd.config";

describe("ffd.config", () => {
  const original = process.env.FFD_DEDUCE_EVENTS;

  afterEach(() => {
    if (original === undefined) delete process.env.FFD_DEDUCE_EVENTS;
    else process.env.FFD_DEDUCE_EVENTS = original;
  });

  it("enables the events deduction by default", () => {
    delete process.env.FFD_DEDUCE_EVENTS;
    expect(ffdConfig().deduceEvents).toBe(true);
  });

  it.each([
    ["false", false],
    [" FALSE ", false],
    ["true", true],
  ])("reads FFD_DEDUCE_EVENTS=%j as %s", (value, expected) => {
    process.env.FFD_DEDUCE_EVENTS = value;
    expect(ffdConfig().deduceEvents).toBe(expected);
  });
});
