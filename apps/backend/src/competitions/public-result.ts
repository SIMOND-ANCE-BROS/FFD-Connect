import { Prisma } from "@prisma/client";
import { publicResultSelect } from "../utils/prisma-selects";
import { PublicResultDto } from "./dto/competition-result.dto";

/**
 * Keys of the free-form `Result.details` (import JSON) that may be published:
 * the official ranking as the organiser publishes it, nothing else.
 * Allow-list, so a key a future import adds (licence number, birth date...)
 * is never published by accident (#413).
 */
export const PUBLIC_RESULT_DETAIL_KEYS = [
  "participant",
  "name",
  "club",
  "bib",
  "status",
  "marks",
  "totalParticipants",
] as const;

/** A `Result` row read with (at least) `publicResultSelect`. */
export type PublicResultSource = Prisma.ResultGetPayload<{
  select: typeof publicResultSelect;
}>;

/**
 * Reduces `details` to the public keys. Always an object: the live results
 * screen reads `details.participant` without a null guard.
 */
export function publicResultDetails(
  details: Prisma.JsonValue,
): Record<string, Prisma.JsonValue> {
  const kept: Record<string, Prisma.JsonValue> = {};
  if (details && typeof details === "object" && !Array.isArray(details)) {
    for (const key of PUBLIC_RESULT_DETAIL_KEYS) {
      const value = details[key];
      if (value !== undefined && value !== null) kept[key] = value;
    }
  }
  return kept;
}

/**
 * Public shape of a result row, shared by every channel that publishes
 * results (REST `GET /competitions/:id/results`, websocket
 * `result_published`). Copied field by field so a wider row (with `userId`,
 * `createdAt`...) never leaks an account id (#413, #429).
 */
export function toPublicResult(res: PublicResultSource): PublicResultDto {
  return {
    id: res.id,
    eventId: res.eventId,
    round: res.round,
    ranking: res.ranking,
    details: publicResultDetails(res.details),
  };
}
