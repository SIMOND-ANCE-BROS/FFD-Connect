import { Prisma, TrackStatus } from "@prisma/client";
import { MockPrismaService } from "./prisma.mock";

/**
 * In-memory track row. Carries the fields the library visibility filter reads,
 * plus whatever else a test wants returned (title, bpm, …).
 */
export type TrackRow = {
  id: string;
  artist: string;
  style: string | null;
  status: TrackStatus;
  blacklisted: boolean;
} & Record<string, unknown>;

interface ScalarFilter {
  equals?: unknown;
  not?: { equals?: unknown };
  mode?: "insensitive" | "default";
}

const normalize = (value: unknown, insensitive: boolean): unknown =>
  insensitive && typeof value === "string" ? value.toLowerCase() : value;

/**
 * Evaluates the subset of Prisma `TrackWhereInput` used by the services (AND /
 * OR, plain equality, `equals`, `not.equals`, `mode: "insensitive"`) against a
 * row, so tests check what a filter does rather than its exact shape. Throws on
 * anything else so an unsupported filter cannot silently match.
 */
export function matchesTrackWhere(
  row: TrackRow,
  where: Prisma.TrackWhereInput,
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") {
      const parts = (
        Array.isArray(condition) ? condition : [condition]
      ) as Prisma.TrackWhereInput[];
      return parts.every((part) => matchesTrackWhere(row, part));
    }
    if (key === "OR") {
      return (condition as Prisma.TrackWhereInput[]).some((part) =>
        matchesTrackWhere(row, part),
      );
    }
    const value = row[key];
    if (condition === null || typeof condition !== "object") {
      return value === condition;
    }
    const filter = condition as ScalarFilter;
    const insensitive = filter.mode === "insensitive";
    if (filter.not && "equals" in filter.not) {
      // SQL semantics: NULL never satisfies a NOT EQUALS comparison.
      return (
        value !== null &&
        normalize(value, insensitive) !==
          normalize(filter.not.equals, insensitive)
      );
    }
    if ("equals" in filter) {
      return (
        normalize(value, insensitive) === normalize(filter.equals, insensitive)
      );
    }
    throw new Error(`Unsupported track filter on "${key}"`);
  });
}

/** Wires `track.findFirst` to an in-memory table filtered by the real `where`. */
export function useTrackTable(
  prisma: MockPrismaService,
  rows: readonly TrackRow[],
): void {
  prisma.track.findFirst.mockImplementation(((args: {
    where: Prisma.TrackWhereInput;
  }) =>
    Promise.resolve(
      rows.find((row) => matchesTrackWhere(row, args.where)) ?? null,
    )) as unknown as typeof prisma.track.findFirst);
}

/**
 * Tracks that exist but sit outside the library: a non-admin must get the
 * same 404 as for a missing track. Each entry overrides a visible row.
 */
export const HIDDEN_TRACK_CASES: ReadonlyArray<[string, Partial<TrackRow>]> = [
  ["blacklisted", { blacklisted: true }],
  ["PENDING", { status: TrackStatus.PENDING }],
  ["ERROR", { status: TrackStatus.ERROR }],
  ["Ambiance (artist)", { artist: "ambiance" }],
  ["Ambiance (style)", { style: "AMBIANCE" }],
];
