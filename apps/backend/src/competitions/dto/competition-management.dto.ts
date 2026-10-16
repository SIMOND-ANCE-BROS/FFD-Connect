import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CompetitionStatus, CompetitionType } from "@prisma/client";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
} from "class-validator";
import { IsSeatLayout } from "./seat-layout.validator";

const LAYOUT_API_PROPERTY = {
  description:
    "Plan de salle : éléments libres (`id`, `type`, `label`, position…). `priceCents` (optionnel, entier de 1 à 1 000 000) est le tarif de la place en centimes, facturé par le paiement HelloAsso.",
  example: [{ id: "t1", type: "TABLE", label: "Table 1", priceCents: 1500 }],
  type: "array",
  items: { type: "object", additionalProperties: true },
} as const;

const REQUIRE_ROTATING_QR_API_PROPERTY = {
  description:
    "QR d'entrée tournant obligatoire au check-in (#668, ADR-0024) : les QR statiques (v1/v2 — pass Wallet, anciennes versions de l'app) sont alors refusés, en ligne comme hors ligne. Désactivé par défaut. Refusé (400) si le QR tournant n'est pas configuré sur le serveur.",
  example: false,
  default: false,
} as const;

export class CreateCompetitionDto {
  @ApiProperty({ example: "Championnat de France 2026" })
  @IsString()
  title!: string;

  @ApiProperty({ example: "2026-05-15T10:00:00Z" })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({
    description:
      "Date limite d'inscription. Passé cet instant, l'inscription est refusée (#821). Omise, l'inscription reste ouverte jusqu'à la compétition. Doit être antérieure ou égale à `date`.",
    example: "2026-05-01T23:59:00Z",
  })
  @IsDateString()
  @IsOptional()
  registrationDeadline?: string;

  @ApiProperty({ example: "Paris, France" })
  @IsString()
  location!: string;

  @ApiPropertyOptional({ enum: CompetitionStatus, default: "UPCOMING" })
  @IsEnum(CompetitionStatus)
  @IsOptional()
  status?: CompetitionStatus;

  @ApiPropertyOptional({ example: "https://www.helloasso.com/..." })
  @IsUrl()
  @IsOptional()
  ticketingUrl?: string;

  @ApiPropertyOptional(LAYOUT_API_PROPERTY)
  @IsOptional()
  @IsSeatLayout()
  layout?: Record<string, unknown>[];

  @ApiPropertyOptional({ enum: CompetitionType })
  @IsEnum(CompetitionType)
  @IsOptional()
  competitionType?: CompetitionType;

  @ApiPropertyOptional({
    description:
      "Requis si competitionType=MAJEURE. Ex: CHAMPIONNAT_REGIONAL, CHAMPIONNAT_FRANCE_LATINES, CRITERIUMS_NATIONAUX",
  })
  @IsString()
  @IsOptional()
  majorSubType?: string;

  @ApiPropertyOptional({
    description:
      'Nature : "COMPETITION" (défaut) ou "EVENT" (événement non compétitif).',
    example: "COMPETITION",
  })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({
    description:
      "Programme (texte libre) — programme des épreuves / événement.",
  })
  @IsString()
  @IsOptional()
  eventsDescription?: string;

  @ApiPropertyOptional(REQUIRE_ROTATING_QR_API_PROPERTY)
  @IsBoolean()
  @IsOptional()
  requireRotatingQr?: boolean;
}

export class UpdateCompetitionDto {
  @ApiPropertyOptional({ example: "Championnat de France 2026" })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: "2026-05-15T10:00:00Z" })
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({
    description:
      "Date limite d'inscription. `null` l'efface (inscription rouverte jusqu'à la compétition). Doit être antérieure ou égale à la date de la compétition.",
    example: "2026-05-01T23:59:00Z",
    // Explicit: the `string | null` union otherwise reflects as `type: object`.
    type: String,
    nullable: true,
  })
  @ValidateIf((o: UpdateCompetitionDto) => o.registrationDeadline !== null)
  @IsDateString()
  @IsOptional()
  registrationDeadline?: string | null;

  @ApiPropertyOptional({ example: "Paris, France" })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ enum: CompetitionStatus })
  @IsEnum(CompetitionStatus)
  @IsOptional()
  status?: CompetitionStatus;

  @ApiPropertyOptional({ example: "https://www.helloasso.com/..." })
  @IsUrl()
  @IsOptional()
  ticketingUrl?: string;

  @ApiPropertyOptional(LAYOUT_API_PROPERTY)
  @IsOptional()
  @IsSeatLayout()
  layout?: Record<string, unknown>[];

  @ApiPropertyOptional({ enum: CompetitionType })
  @IsEnum(CompetitionType)
  @IsOptional()
  competitionType?: CompetitionType;

  @ApiPropertyOptional({
    description:
      "Requis si competitionType=MAJEURE. `null` l'efface (compétition passée à un autre type).",
    // Explicit: the `string | null` union otherwise reflects as `type: object`.
    type: String,
    nullable: true,
  })
  @IsString()
  @IsOptional()
  majorSubType?: string | null;

  @ApiPropertyOptional({
    description:
      'Nature : "COMPETITION" (défaut) ou "EVENT" (événement non compétitif).',
    example: "COMPETITION",
  })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({
    description:
      "Programme (texte libre) — programme des épreuves / événement.",
  })
  @IsString()
  @IsOptional()
  eventsDescription?: string;

  @ApiPropertyOptional(REQUIRE_ROTATING_QR_API_PROPERTY)
  @IsBoolean()
  @IsOptional()
  requireRotatingQr?: boolean;
}
