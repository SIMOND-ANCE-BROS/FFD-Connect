import { diffFields } from "./admin-audit.util";

describe("diffFields", () => {
  it("keeps only the keys whose value changed", () => {
    expect(
      diffFields(
        { firstName: "A", lastName: "B", clubId: null },
        { firstName: "A", lastName: "C", clubId: "c1" },
      ),
    ).toEqual({
      before: { lastName: "B", clubId: null },
      after: { lastName: "C", clubId: "c1" },
    });
  });

  it("returns null when nothing changed", () => {
    expect(diffFields({ a: 1 }, { a: 1 })).toBeNull();
  });

  it("treats undefined in before as null", () => {
    expect(diffFields({}, { nationalRanking: 3 })).toEqual({
      before: { nationalRanking: null },
      after: { nationalRanking: 3 },
    });
  });
});
