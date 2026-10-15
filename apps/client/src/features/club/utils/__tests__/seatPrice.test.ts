import { parseSeatPrice, seatPriceToInput } from "../seatPrice";

describe("parseSeatPrice (#405)", () => {
  it.each([
    ["15", 1500],
    ["15,5", 1550],
    ["15.50", 1550],
    [" 15 € ", 1500],
    ["0,01", 1],
    ["10000", 1_000_000],
  ])("parses %p into %p cents", (text, cents) => {
    expect(parseSeatPrice(text)).toEqual({ ok: true, cents });
  });

  it("treats an empty field as no price", () => {
    expect(parseSeatPrice("")).toEqual({ ok: true, cents: undefined });
    expect(parseSeatPrice("   ")).toEqual({ ok: true, cents: undefined });
  });

  it.each([["abc"], ["15,555"], ["-5"], ["1e3"], ["15,,5"]])(
    "refuses %p",
    (text) => {
      expect(parseSeatPrice(text).ok).toBe(false);
    },
  );

  it("refuses zero and amounts above the server bound", () => {
    expect(parseSeatPrice("0").ok).toBe(false);
    expect(parseSeatPrice("10000,01").ok).toBe(false);
  });
});

describe("seatPriceToInput", () => {
  it("formats cents for the editor field", () => {
    expect(seatPriceToInput(1500)).toBe("15");
    expect(seatPriceToInput(1550)).toBe("15,50");
    expect(seatPriceToInput(undefined)).toBe("");
    expect(seatPriceToInput(0)).toBe("");
  });

  it("round-trips with parseSeatPrice", () => {
    for (const cents of [1, 99, 1500, 1550, 1_000_000]) {
      expect(parseSeatPrice(seatPriceToInput(cents))).toEqual({
        ok: true,
        cents,
      });
    }
  });
});
