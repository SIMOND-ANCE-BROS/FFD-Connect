import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { EventKind, EventsSource, EventType } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import {
  CLOCK_PATTERN,
  MAX_PROGRAM_EVENTS,
  MAX_SCHEDULE_ITEMS,
  SCHEDULE_ITEM_TYPES,
  type ScheduleItemType,
} from "../program/program-rules";

/** Longest schedule slot accepted (12 h). */
const MAX_SLOT_MINUTES = 720;

export class ProgramEventInputDto {
  @ApiPropertyOptional({
    description:
      "Identifiant d'une épreuve déjà enregistrée de cette compétition (mise à jour). Absent : nouvelle épreuve.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiPropertyOptional({
    // `null` listed so the generated client types it as nullable.
    enum: [...Object.values(EventKind), null],
    nullable: true,
    description:
      "Nature de l'épreuve (Article 9). Requise pour une épreuve nouvelle ou modifiée ; null seulement pour renvoyer telle quelle une épreuve importée de la FFD sans nature.",
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEnum(EventKind)
  eventKind?: EventKind | null;

  @ApiProperty({ enum: EventType })
  @IsEnum(EventType)
  eventType!: EventType;

  @ApiProperty({
    description:
      "Spécialité : Latin, Standard ou Ten Dance (les libellés « Latines », « Standards », « 10 danses » sont acceptés). Ignorée pour une épreuve Solo Team.",
    example: "Latin",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  category!: string;

  @ApiPropertyOptional({
    description:
      "Classe d'âge (Article 5, « Espoir » en couple, « Solo … » en solo). Pour un Open, la première des `ageGroups`.",
    example: "Adulte",
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ageGroup?: string;

  @ApiPropertyOptional({
    description: "Open uniquement : classes d'âge réunies (au moins une).",
    type: [String],
    example: ["Youth", "Adulte"],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  ageGroups?: string[];

  @ApiPropertyOptional({
    description:
      "Classificatrice : niveau de l'épreuve. Solo Team : Débutant ou Intermédiaire. Absent pour les autres natures.",
    type: String,
    nullable: true,
    example: "Intermédiaire",
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  level?: string | null;

  @ApiPropertyOptional({
    description: "Open uniquement : niveaux admis (vide = tous niveaux).",
    type: [String],
    example: ["Débutant", "Intermédiaire"],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  openLevels?: string[];
}

export class ProgramScheduleItemInputDto {
  @ApiPropertyOptional({
    description:
      "Identifiant d'un créneau déjà enregistré de cette compétition. Absent : nouveau créneau.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiProperty({
    description:
      "Heure de début `HH:MM`, heure française, le jour de la compétition.",
    example: "10:00",
  })
  @IsString()
  @Matches(CLOCK_PATTERN, { message: "startTime doit être au format HH:MM" })
  startTime!: string;

  @ApiProperty({ description: "Durée en minutes", example: 15 })
  @IsInt()
  @Min(0)
  @Max(MAX_SLOT_MINUTES, {
    message: `un créneau dure au plus ${MAX_SLOT_MINUTES} minutes`,
  })
  durationMinutes!: number;

  @ApiProperty({ enum: SCHEDULE_ITEM_TYPES, example: "ROUND" })
  @IsIn(SCHEDULE_ITEM_TYPES)
  type!: ScheduleItemType;

  @ApiProperty({ example: "Latines Adulte — 1/4 de finale" })
  @IsString()
  @Matches(/\S/, { message: "title ne doit pas être vide" })
  @MaxLength(120)
  title!: string;
}

/**
 * The whole programme of a competition, as entered in the club editor: it
 * replaces the stored one. Events left out are deleted, unless they have
 * registrations or results (409, nothing is changed).
 */
export class ReplaceCompetitionProgramDto {
  @ApiProperty({ type: [ProgramEventInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_PROGRAM_EVENTS)
  @ValidateNested({ each: true })
  @Type(() => ProgramEventInputDto)
  events!: ProgramEventInputDto[];

  @ApiProperty({ type: [ProgramScheduleItemInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_SCHEDULE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ProgramScheduleItemInputDto)
  schedule!: ProgramScheduleItemInputDto[];
}

export class ProgramEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: [...Object.values(EventKind), null], nullable: true })
  eventKind!: EventKind | null;

  @ApiProperty({ enum: EventType })
  eventType!: EventType;

  @ApiProperty({ example: "Latin" })
  category!: string;

  @ApiProperty({ example: "Adulte" })
  ageGroup!: string;

  @ApiProperty({ type: [String] })
  ageGroups!: string[];

  @ApiProperty({ type: String, nullable: true })
  level!: string | null;

  @ApiProperty({ type: [String] })
  openLevels!: string[];

  @ApiProperty({
    description:
      "L'épreuve a des inscriptions ou des résultats : elle ne peut être ni modifiée ni supprimée.",
  })
  locked!: boolean;

  @ApiProperty({
    description:
      "Nombre de résultats importés pour l'épreuve (0 : aucun résultat).",
    example: 0,
  })
  resultCount!: number;
}

export class ProgramScheduleItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "Heure de début `HH:MM` (heure française)" })
  startTime!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Durée en minutes (inconnue pour un créneau antérieur à #442)",
  })
  durationMinutes!: number | null;

  @ApiProperty({ example: "ROUND" })
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  eventId!: string | null;
}

export class CompetitionProgramDto {
  @ApiProperty()
  competitionId!: string;

  @ApiProperty({
    description:
      "Compétition importée de la FFD. Une fois le programme enregistré par le club, la synchronisation ne remplace plus ses épreuves.",
  })
  syncedFromFfd!: boolean;

  @ApiProperty({
    enum: [...Object.values(EventsSource), null],
    nullable: true,
    description:
      "Origine des épreuves déduites par la synchronisation FFD (null : saisies par le club ou antérieures).",
  })
  eventsSource!: EventsSource | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    description: "Dernier enregistrement du programme par le club.",
  })
  programEditedAt!: Date | null;

  @ApiProperty({ type: [ProgramEventDto] })
  events!: ProgramEventDto[];

  @ApiProperty({ type: [ProgramScheduleItemDto] })
  schedule!: ProgramScheduleItemDto[];
}
