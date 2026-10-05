import { CoupleMarks, SkatingSystem } from "./skating.util";

describe("SkatingSystem", () => {
  it("should calculate places correctly for a simple majority", () => {
    const performances: CoupleMarks[] = [
      {
        coupleId: "C1",
        marks: [
          { judgeId: "J1", place: 1 },
          { judgeId: "J2", place: 1 },
          { judgeId: "J3", place: 2 },
        ],
      },
      {
        coupleId: "C2",
        marks: [
          { judgeId: "J1", place: 2 },
          { judgeId: "J2", place: 2 },
          { judgeId: "J3", place: 1 },
        ],
      },
    ];

    const results = SkatingSystem.calculatePlaces(performances);
    expect(results.get("C1")).toBe(1);
    expect(results.get("C2")).toBe(2);
  });

  it("should handle Rule 6 (Greater Majority) tie-break", () => {
    const performances: CoupleMarks[] = [
      {
        coupleId: "C1",
        marks: [
          { judgeId: "J1", place: 1 },
          { judgeId: "J2", place: 1 },
          { judgeId: "J3", place: 1 },
          { judgeId: "J4", place: 2 },
          { judgeId: "J5", place: 2 },
        ],
      },
      {
        coupleId: "C2",
        marks: [
          { judgeId: "J1", place: 1 },
          { judgeId: "J2", place: 1 },
          { judgeId: "J3", place: 2 },
          { judgeId: "J4", place: 2 },
          { judgeId: "J5", place: 2 },
        ],
      },
    ];

    const results = SkatingSystem.calculatePlaces(performances);
    expect(results.get("C1")).toBe(1); // 3 firsts vs 2 firsts
    expect(results.get("C2")).toBe(2);
  });

  it("should handle Rule 7 (Lower Sum) tie-break", () => {
    // Let's test place 1 with majority=3:
    const p2: CoupleMarks[] = [
      {
        coupleId: "C1",
        marks: [
          { judgeId: "J1", place: 1 },
          { judgeId: "J2", place: 2 },
          { judgeId: "J3", place: 2 }, // Count=3, Sum=5
          { judgeId: "J4", place: 5 },
          { judgeId: "J5", place: 5 },
        ],
      },
      {
        coupleId: "C2",
        marks: [
          { judgeId: "J1", place: 1 },
          { judgeId: "J2", place: 1 },
          { judgeId: "J3", place: 4 },
          { judgeId: "J4", place: 2 }, // Count=3, Sum=4 (1+1+2)
          { judgeId: "J5", place: 5 },
        ],
      },
    ];

    const results = SkatingSystem.calculatePlaces(p2);
    expect(results.get("C2")).toBe(1);
    expect(results.get("C1")).toBe(2);
  });

  it("should handle complex ties with multiple couples", () => {
    const p: CoupleMarks[] = [
      {
        coupleId: "A",
        marks: [
          { judgeId: "1", place: 1 },
          { judgeId: "2", place: 3 },
          { judgeId: "3", place: 3 },
        ],
      },
      {
        coupleId: "B",
        marks: [
          { judgeId: "1", place: 2 },
          { judgeId: "2", place: 1 },
          { judgeId: "3", place: 2 },
        ],
      },
      {
        coupleId: "C",
        marks: [
          { judgeId: "1", place: 3 },
          { judgeId: "2", place: 2 },
          { judgeId: "3", place: 1 },
        ],
      },
    ];

    const res = SkatingSystem.calculatePlaces(p);
    expect(res.get("B")).toBe(1);
    expect(res.get("C")).toBe(2);
    expect(res.get("A")).toBe(3);
  });
});
