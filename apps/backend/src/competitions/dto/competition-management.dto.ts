import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CompetitionStatus, CompetitionType } from "@prisma/client";
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
} from "class-validator";

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

  @ApiPropertyOptional({ example: '[{"type": "TABLE", "label": "Table 1"}]' })
  @IsOptional()
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

  @ApiPropertyOptional({ example: '[{"type": "TABLE", "label": "Table 1"}]' })
  @IsOptional()
  layout?: Record<string, unknown>[];

  @ApiPropertyOptional({ enum: CompetitionType })
  @IsEnum(CompetitionType)
  @IsOptional()
  competitionType?: CompetitionType;

  @ApiPropertyOptional({
    description: "Requis si competitionType=MAJEURE.",
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
}
