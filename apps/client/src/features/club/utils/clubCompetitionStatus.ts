import type { ApiCompetition } from "@ffd-connect/shared";
import { getEffectiveCompetitionStatus } from "../../competitions/utils/competitionCard";

export type ClubCompetitionDisplayStatus =
  | "UPCOMING"
  | "LIVE"
  | "PAST"
  | "CANCELLED";

type StatusFields = Pick<ApiCompetition, "status" | "date">;

/**
 * Status shown for a club competition: CANCELLED as stored, otherwise derived
 * from the date (a stored UPCOMING can be stale), like the public list.
 */
export function displayStatus(
  competition: StatusFields,
  now: Date = new Date(),
): ClubCompetitionDisplayStatus {
  if (competition.status === "CANCELLED") return "CANCELLED";
  const effective = getEffectiveCompetitionStatus(
    competition.status,
    competition.date,
    now,
  );
  return effective === "LIVE" || effective === "PAST" ? effective : "UPCOMING";
}

/**
 * Number of the club's competitions still to come or under way (#441): the
 * figure of the dashboard « Compétitions » card, same rule as the « À venir »
 * filter of « Mes compétitions ».
 */
export function countActiveClubCompetitions(
  competitions: readonly StatusFields[],
  now: Date = new Date(),
): number {
  return competitions.filter((c) => {
    const status = displayStatus(c, now);
    return status === "UPCOMING" || status === "LIVE";
  }).length;
}
