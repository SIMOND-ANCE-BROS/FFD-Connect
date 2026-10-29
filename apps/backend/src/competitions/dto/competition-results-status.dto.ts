import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";

/** Most competitions asked at once: above the back-office page size (50). */
export const MAX_RESULTS_STATUS_IDS = 100;

/**
 * Results import status of a competition (#846): NONE = no event has
 * results, PARTIAL = some events have results but not all, COMPLETE = every
 * event has results.
 */
export const COMPETITION_RESULTS_STATUSES = [
  "NONE",
  "PARTIAL",
  "COMPLETE",
] as const;
export type CompetitionResultsStatus =
  (typeof COMPETITION_RESULTS_STATUSES)[number];

/**
 * `ids` arrives as a string for a single value and as an array when repeated
 * (`ids=A&ids=B`, what the generated clients send); each item may itself be
 * comma-separated (`ids=A,B`). Normalised to a flat, deduplicated list.
 */
const toIdList = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return value;
  const items: unknown[] = Array.isArray(value) ? value : [value];
  const flat = items
    .flatMap((item) => (typeof item === "string" ? item.split(",") : [item]))
    .map((item) => (typeof item === "string" ? item.trim() : item))
    .filter((item) => item !== "");
  return [...new Set(flat)];
};

/** `GET /admin/competitions/results-status?ids=`. */
export class CompetitionResultsStatusQueryDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    minItems: 1,
    maxItems: MAX_RESULTS_STATUS_IDS,
    description: `IDs des compétitions (1 à ${MAX_RESULTS_STATUS_IDS}), répétés (\`ids=A&ids=B\`) ou séparés par des virgules`,
  })
  @Transform(toIdList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RESULTS_STATUS_IDS)
  @IsUUID("all", { each: true })
  ids!: string[];
}

/** Results import status of one competition. */
export class CompetitionResultsStatusDto {
  @ApiProperty({ description: "ID de la compétition" })
  competitionId!: string;

  @ApiProperty({ description: "Nombre d'épreuves de la compétition" })
  eventCount!: number;

  @ApiProperty({
    description: "Nombre d'épreuves ayant au moins un résultat importé",
  })
  eventsWithResults!: number;

  @ApiProperty({
    enum: COMPETITION_RESULTS_STATUSES,
    description:
      "NONE : aucune épreuve n'a de résultat ; PARTIAL : certaines épreuves seulement ; COMPLETE : toutes les épreuves",
    example: "PARTIAL",
  })
  resultsStatus!: CompetitionResultsStatus;
}
