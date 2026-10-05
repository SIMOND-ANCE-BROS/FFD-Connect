export interface JudgeMark {
  judgeId: string;
  place: number;
}

export interface CoupleMarks {
  coupleId: string;
  marks: JudgeMark[];
}

export class SkatingSystem {
  /**
   * Simple Rule 5 & 6 (Majority) implementation for a single dance/round
   * @param performances Array of couples with their marks from judges
   */
  static calculatePlaces(performances: CoupleMarks[]): Map<string, number> {
    const numJudges = performances[0].marks.length;
    const majority = Math.floor(numJudges / 2) + 1;
    const numCouples = performances.length;

    const results = new Map<string, number>();
    const coupleIds = performances.map((p) => p.coupleId);
    let nextPlaceToAssign = 1;

    // Iterate through levels (1st, 1-2, 1-3...)
    for (let level = 1; level <= numCouples; level++) {
      // While there are candidates with majority at this level

      let hasCandidates = coupleIds.some((id) => !results.has(id));
      while (hasCandidates) {
        const candidates = coupleIds.filter((id) => !results.has(id));

        const levelStats = candidates.map((id) => {
          const marks = performances.find((p) => p.coupleId === id)!.marks;
          const countAtLevelOrBetter = marks.filter(
            (m) => m.place <= level,
          ).length;
          const sumAtLevelOrBetter = marks
            .filter((m) => m.place <= level)
            .reduce((sum, m) => sum + m.place, 0);

          return { id, count: countAtLevelOrBetter, sum: sumAtLevelOrBetter };
        });

        // Filter those who have majority at this level
        const withMajority = levelStats.filter((s) => s.count >= majority);

        if (withMajority.length === 0) break;

        // Tie-break: Rule 6 (Greater majority)
        const maxCount = Math.max(...withMajority.map((s) => s.count));
        const bestMajority = withMajority.filter((s) => s.count === maxCount);

        if (bestMajority.length === 1) {
          results.set(bestMajority[0].id, nextPlaceToAssign++);
          hasCandidates = coupleIds.some((id) => !results.has(id));
          continue; // Re-check others at same level
        }

        // Tie-break: Rule 7 (Lower sum)
        const minSum = Math.min(...bestMajority.map((s) => s.sum));
        const bestSum = bestMajority.filter((s) => s.sum === minSum);

        if (bestSum.length === 1) {
          results.set(bestSum[0].id, nextPlaceToAssign++);
          hasCandidates = coupleIds.some((id) => !results.has(id));
          continue;
        }

        // Final tie-break: Assign remaining ties sequentially for MVP
        for (const candidate of bestSum) {
          results.set(candidate.id, nextPlaceToAssign++);
        }
        hasCandidates = coupleIds.some((id) => !results.has(id));
      }
    }

    return results;
  }
}
