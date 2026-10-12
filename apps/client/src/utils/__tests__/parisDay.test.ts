import { parisDayIndex } from "../parisDay";

describe("parisDayIndex", () => {
  const day = (iso: string) => parisDayIndex(new Date(iso));

  it("uses the Paris calendar day, not the UTC one", () => {
    // 23:30 UTC on August 31 is already September 1 in Paris (CEST).
    expect(day("2027-08-31T22:30:00Z") - day("2027-08-31T10:00:00Z")).toBe(1);
    // 23:30 UTC on December 31 is already January 1 in Paris (CET).
    expect(day("2027-12-31T23:30:00Z") - day("2027-12-31T10:00:00Z")).toBe(1);
  });

  it("keeps the same index for a whole Paris day", () => {
    expect(day("2027-08-30T22:00:00Z")).toBe(day("2027-08-31T21:59:59.999Z"));
  });

  it("counts whole days across DST changes", () => {
    expect(day("2027-11-02T22:59:59.999Z") - day("2027-10-30T10:00:00Z")).toBe(
      3,
    );
    expect(day("2027-03-29T10:00:00Z") - day("2027-03-27T10:00:00Z")).toBe(2);
  });

  it("returns NaN when the runtime cannot format the date", () => {
    const spy = jest
      .spyOn(Date.prototype, "toLocaleDateString")
      .mockReturnValue("not-a-date");
    expect(Number.isNaN(day("2027-08-31T10:00:00Z"))).toBe(true);
    spy.mockRestore();
  });
});
