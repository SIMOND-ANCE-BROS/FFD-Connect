import { applyDecorators } from "@nestjs/common";
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from "@nestjs/swagger";
import {
  CompetitionStatus,
  CompetitionType,
  EventKind,
  EventsSource,
  EventType,
  RegistrationStatus,
} from "@prisma/client";

/**
 * Response shapes of `GET /competitions`, `GET /competitions/:id` (#712) and
 * `GET /competitions/active` (#729). Documentation only: they mirror
 * COMPETITION_BASE_SELECT / EVENT_BASE_SELECT of CompetitionQueryService —
 * keep both in sync when a selected field moves.
 */

const nullableString = (description?: string, example?: string) => ({
  type: String,
  nullable: true,
  description,
  example,
});

const nullableDate = (description?: string) => ({
  type: String,
  format: "date-time",
  nullable: true,
  description,
});

/** The current user's active registration to an event (authenticated list). */
export class CompetitionEventRegistrationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty(nullableString())
  partnerName!: string | null;

  @ApiProperty({ enum: RegistrationStatus })
  status!: RegistrationStatus;

  @ApiProperty({ type: Number, nullable: true })
  bibNumber!: number | null;

  @ApiProperty()
  checkedIn!: boolean;

  @ApiProperty(nullableDate())
  checkInTime!: Date | null;

  @ApiProperty()
  feePaid!: boolean;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty(nullableString())
  coupleAgeGroup!: string | null;

  @ApiProperty()
  coupleDisciplineLatin!: boolean;

  @ApiProperty()
  coupleDisciplineStandard!: boolean;
}

/** An event (épreuve) of a competition. */
export class CompetitionEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description: "Spécialité : Latin, Standard ou Ten Dance",
    example: "Latin",
  })
  category!: string;

  @ApiProperty({ description: "Classe d'âge de l'épreuve", example: "Adulte" })
  ageGroup!: string;

  @ApiProperty({ enum: EventType })
  eventType!: EventType;

  @ApiProperty(nullableString("Niveau d'une épreuve classificatrice", "Avancé"))
  level!: string | null;

  @ApiProperty({
    // `null` listed so the generated client types it as nullable.
    enum: [...Object.values(EventKind), null],
    nullable: true,
    description: "Nature de l'épreuve (Article 9)",
  })
  eventKind!: EventKind | null;

  @ApiProperty({
    type: [String],
    description: "Open : classes d'âge réunies (vide hors Open)",
  })
  ageGroups!: string[];

  @ApiProperty({
    type: [String],
    description: "Open : niveaux admis (vide = tous niveaux)",
  })
  openLevels!: string[];
}

/** Event of the list, with the caller's registrations when authenticated. */
export class CompetitionListEventDto extends CompetitionEventDto {
  @ApiPropertyOptional({
    type: [CompetitionEventRegistrationDto],
    description:
      "Authentifié uniquement : inscriptions actives (PENDING, CONFIRMED) de l'utilisateur à cette épreuve.",
  })
  registrations?: CompetitionEventRegistrationDto[];
}

/** A slot of the competition schedule. */
export class CompetitionScheduleItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, format: "date-time" })
  startTime!: Date;

  @ApiProperty()
  title!: string;

  @ApiProperty({ example: "EVENT" })
  type!: string;

  @ApiProperty(nullableString("Épreuve concernée"))
  eventId!: string | null;
}

/** Fields returned for every competition (COMPETITION_BASE_SELECT). */
export class CompetitionBaseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty(nullableString("Identifiant FFD (null : créée dans l'app)"))
  ffdId!: string | null;

  @ApiProperty({ example: "Championnat de France 2026" })
  title!: string;

  @ApiProperty({
    type: String,
    format: "date-time",
    description: "Date de début",
  })
  date!: Date;

  @ApiProperty({ example: "Palais des Sports" })
  location!: string;

  @ApiProperty(nullableString())
  address!: string | null;

  @ApiProperty(nullableString())
  zipCode!: string | null;

  @ApiProperty(nullableString(undefined, "Paris"))
  city!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  latitude!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  longitude!: number | null;

  @ApiProperty(nullableString())
  description!: string | null;

  @ApiProperty(nullableString("Programme des épreuves (texte libre FFD)"))
  eventsDescription!: string | null;

  @ApiProperty(nullableString("PDF du programme des épreuves"))
  programUrl!: string | null;

  @ApiProperty(nullableDate("Date de fin"))
  endDate!: Date | null;

  @ApiProperty(nullableString("Libellé libre du type (affichage)"))
  type!: string | null;

  @ApiProperty({
    enum: [...Object.values(CompetitionType), null],
    nullable: true,
    description: "Article 8",
  })
  competitionType!: CompetitionType | null;

  @ApiProperty(nullableString("Sous-type d'une compétition MAJEURE"))
  majorSubType!: string | null;

  @ApiProperty(nullableString("Libellé du club organisateur"))
  organizer!: string | null;

  @ApiProperty(nullableString("Club organisateur relié (#408)"))
  organizerClubId!: string | null;

  @ApiProperty(nullableString())
  circularUrl!: string | null;

  @ApiProperty(nullableString())
  registrationUrl!: string | null;

  @ApiProperty(nullableString())
  ticketingUrl!: string | null;

  @ApiProperty({
    description: "Plan de salle : éléments libres (`id`, `type`, `label`…)",
    type: "array",
    items: { type: "object", additionalProperties: true },
    nullable: true,
  })
  layout!: Record<string, unknown>[] | null;

  @ApiProperty(nullableString())
  imageUrl!: string | null;

  @ApiProperty(nullableDate("Date limite d'inscription"))
  registrationDeadline!: Date | null;

  @ApiProperty({
    enum: [...Object.values(EventsSource), null],
    nullable: true,
    description:
      "Origine des épreuves synchronisées (DESCRIPTION / CIRCULAR = déduites, à vérifier)",
  })
  eventsSource!: EventsSource | null;

  @ApiProperty({
    enum: CompetitionStatus,
    example: CompetitionStatus.UPCOMING,
  })
  status!: CompetitionStatus;

  @ApiProperty({ description: "Retard annoncé, en minutes", example: 0 })
  delayMinutes!: number;

  @ApiProperty({
    description:
      "QR d'entrée tournant obligatoire au check-in (#668) : les scanners le gardent en cache pour refuser aussi hors ligne un QR statique.",
  })
  requireRotatingQr!: boolean;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

/** One competition of `GET /competitions`. */
export class CompetitionListItemDto extends CompetitionBaseDto {
  @ApiProperty({ type: [CompetitionListEventDto] })
  events!: CompetitionListEventDto[];

  @ApiPropertyOptional({
    description:
      "Authentifié uniquement : l'utilisateur est inscrit à au moins une épreuve.",
  })
  isRegistered?: boolean;

  @ApiPropertyOptional({
    description:
      "Authentifié uniquement : au moins une épreuve est ouverte à l'utilisateur.",
  })
  isEligible?: boolean;

  @ApiPropertyOptional({
    description: "Compte CLUB uniquement : compétition organisée par son club.",
  })
  isOrganizedByMyClub?: boolean;

  @ApiPropertyOptional({
    description:
      "Compte CLUB uniquement : nombre de membres du club inscrits (PENDING, CONFIRMED).",
  })
  clubMembersRegisteredCount?: number;
}

/** Pagination metadata (cf. createPaginatedResponse). */
export class CompetitionPageMetaDto {
  @ApiProperty({ example: 100 })
  total!: number;

  @ApiProperty({ example: 0 })
  skip!: number;

  @ApiProperty({ example: 10 })
  take!: number;

  @ApiProperty({ example: true })
  hasMore!: boolean;
}

/** `GET /competitions`. */
export class CompetitionPageDto {
  @ApiProperty({ type: [CompetitionListItemDto] })
  data!: CompetitionListItemDto[];

  @ApiProperty({ type: CompetitionPageMetaDto })
  meta!: CompetitionPageMetaDto;
}

/** `GET /competitions/active` (ACTIVE_COMPETITION_SELECT, #729). */
export class CompetitionActiveDto extends CompetitionBaseDto {
  @ApiProperty({ type: [CompetitionEventDto] })
  events!: CompetitionEventDto[];
}

/**
 * 200 response of `GET /competitions/active`: the competition starting today,
 * or nothing. The service returns `null` and Nest then sends an empty body —
 * there is no 404.
 */
export const ApiActiveCompetitionResponse = () =>
  applyDecorators(
    ApiExtraModels(CompetitionActiveDto),
    ApiOkResponse({
      description:
        "Compétition qui commence aujourd'hui (heure du serveur), avec ses épreuves. `null` (corps vide) s'il n'y en a aucune.",
      schema: {
        nullable: true,
        allOf: [{ $ref: getSchemaPath(CompetitionActiveDto) }],
      },
    }),
  );

/** `GET /competitions/:id`. */
export class CompetitionDetailDto extends CompetitionBaseDto {
  @ApiProperty({ type: [CompetitionEventDto] })
  events!: CompetitionEventDto[];

  @ApiProperty({ type: [CompetitionScheduleItemDto] })
  schedule!: CompetitionScheduleItemDto[];
}
