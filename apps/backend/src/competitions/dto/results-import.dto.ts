import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

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
      "Contenu CSV du classement (séparateur `;` ou `,`, ligne d'en-tête obligatoire). Colonnes : epreuve (id de l'épreuve), tour, classement, couple ; facultatives : dossard, club, licences (numéros séparés par `|`), statut, participants.",
    example:
      "epreuve;tour;classement;couple;dossard;club;licences\n550e8400-e29b-41d4-a716-446655440001;Finale;1;Martin / Durand;12;Club A;123456|654321",
    maxLength: MAX_RESULTS_CSV_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_RESULTS_CSV_LENGTH)
  csv!: string;
}

/** Outcome of a results import. Counts only: never a name. */
export class ImportResultsReportDto {
  @ApiProperty({ description: "Lignes de résultat créées", example: 12 })
  created!: number;

  @ApiProperty({
    description: "Lignes déjà importées et corrigées",
    example: 0,
  })
  updated!: number;

  @ApiProperty({
    description: "Lignes déjà importées, identiques (import rejoué)",
    example: 0,
  })
  unchanged!: number;

  @ApiProperty({
    description:
      "Lignes déjà importées dont le rattachement à un compte a changé (sous-ensemble de « updated »)",
    example: 0,
  })
  relinked!: number;

  @ApiProperty({
    description:
      "Lignes laissées ou écrites anonymisées : un compte du couple a été supprimé",
    example: 0,
  })
  anonymisedKept!: number;

  @ApiProperty({
    description: "Couples rattachés à un compte (licence ou dossard)",
    example: 4,
  })
  linked!: number;

  @ApiProperty({ description: "Couples sans compte rattaché", example: 8 })
  unlinked!: number;
}
