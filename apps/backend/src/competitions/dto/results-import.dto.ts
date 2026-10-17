import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

/**
 * Upper bound of the CSV text: stays under the default 100 kB JSON body limit
 * of the API (main.ts keeps it), ~1000 lines. A bigger competition is
 * imported in several files (one per épreuve): the import is incremental.
 */
export const MAX_RESULTS_CSV_LENGTH = 80_000;

/**
 * Results file of a competition (#652), sent as its text content (the
 * back-office reads the chosen file and posts it).
 */
export class ImportResultsDto {
  @ApiProperty({
    description:
      "Contenu CSV du classement (séparateur `;` ou `,`, ligne d'en-tête obligatoire). Colonnes : epreuve (id de l'épreuve, ou son nom : spécialité + classe d'âge + niveau, par ex. « Latines Adultes Avancé »), tour, classement, couple ; facultatives : dossard, club, licences (numéros séparés par `|`), statut, participants.",
    example:
      "epreuve;tour;classement;couple;dossard;club;licences\n550e8400-e29b-41d4-a716-446655440001;Finale;1;Martin / Durand;12;Club A;123456|654321",
    maxLength: MAX_RESULTS_CSV_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_RESULTS_CSV_LENGTH)
  csv!: string;
}

/**
 * Query-string flag: only "true" and "false" (what the generated clients
 * send); any other value stays a string and fails @IsBoolean.
 */
const toFlag = ({ value }: { value: unknown }): unknown =>
  value === "true" ? true : value === "false" ? false : value;

/** `?dryRun=true`: validate and count without writing (#690). */
export class ImportResultsQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description:
      "true : valide le fichier et calcule les compteurs sans rien écrire (aperçu), sans journal d'audit ni notification",
    default: false,
  })
  @IsOptional()
  @Transform(toFlag)
  @IsBoolean()
  dryRun?: boolean;
}

/** `?eventId=`: the event whose imported results are removed (#690). */
export class DeleteEventResultsQueryDto {
  @ApiProperty({ description: "ID de l'épreuve de la compétition" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  eventId!: string;
}

/** Outcome of the removal of an event's imported results (#690). */
export class DeleteEventResultsReportDto {
  @ApiProperty({ description: "Lignes de résultat supprimées", example: 12 })
  deleted!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "Lignes gardées parce qu'elles portent un effacement RGPD (compte supprimé, partenaire supprimé). null pour le club organisateur (#713), comme dans le rapport d'import : le nombre reste au journal d'audit.",
    example: 0,
  })
  anonymisedKept!: number | null;
}

/** Outcome of a results import. Counts only: never a name. */
export class ImportResultsReportDto {
  @ApiProperty({
    description: "true : aperçu (dryRun), rien n'a été écrit",
    example: false,
  })
  dryRun!: boolean;

  @ApiProperty({ description: "Lignes de résultat créées", example: 12 })
  created!: number;

  @ApiProperty({
    description:
      "Lignes déjà importées et corrigées (compte club : contenu publié seulement — rang, libellé, dossard…)",
    example: 0,
  })
  updated!: number;

  @ApiProperty({
    description: "Lignes déjà importées, identiques (import rejoué)",
    example: 0,
  })
  unchanged!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      "Null pour un compte club (non communiqué : dépend des numéros de licence). Lignes déjà importées dont le rattachement à un compte a changé (sous-ensemble de « updated »)",
    example: 0,
  })
  relinked!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      "Null pour un compte club (non communiqué : dépend des numéros de licence). Lignes laissées ou écrites anonymisées : un compte du couple a été supprimé",
    example: 0,
  })
  anonymisedKept!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      "Null pour un compte club (non communiqué : dépend des numéros de licence). Couples rattachés à un compte (licence ou dossard)",
    example: 4,
  })
  linked!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      "Null pour un compte club (non communiqué : dépend des numéros de licence). Couples sans compte rattaché",
    example: 8,
  })
  unlinked!: number | null;
}
