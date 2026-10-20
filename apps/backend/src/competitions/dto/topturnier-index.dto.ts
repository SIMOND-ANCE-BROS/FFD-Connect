import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * TEMPORARY (#801, with #787): list of the recent competitions of the
 * TopTurnier site, matched to the competitions of the app.
 */

/** `?year=`: one year of the list (current or previous), both when absent. */
export class ListTopTurnierCompetitionsQueryDto {
  @ApiPropertyOptional({
    description:
      "Année lue (année en cours ou précédente, Europe/Paris). Absente : les deux.",
    example: 2026,
    minimum: 2000,
    maximum: 2100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class TopTurnierCandidateDto {
  @ApiProperty({ description: "ID de la compétition de l'app" })
  id!: string;

  @ApiProperty({ description: "Titre de la compétition de l'app" })
  title!: string;
}

export class TopTurnierCompetitionMatchDto {
  @ApiProperty({
    enum: ["MATCHED", "AMBIGUOUS", "NONE"],
    description:
      "MATCHED : une seule compétition de l'app le même jour et au même endroit ; AMBIGUOUS : plusieurs (à choisir à la main, rien n'est deviné) ; NONE : aucune",
    example: "MATCHED",
  })
  status!: "MATCHED" | "AMBIGUOUS" | "NONE";

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Compétition rapprochée (MATCHED), null sinon",
  })
  competitionId!: string | null;

  @ApiProperty({
    type: [TopTurnierCandidateDto],
    description: "Compétitions possibles d'une entrée AMBIGUOUS (vide sinon)",
  })
  candidates!: TopTurnierCandidateDto[];
}

export class TopTurnierCompetitionItemDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: "Jour de la compétition (YYYY-MM-DD), null si illisible",
    example: "2026-10-17",
  })
  date!: string | null;

  @ApiProperty({
    description: "Titre affiché par le site",
    example: "Exempleville, Trophée d'automne",
  })
  title!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Catégorie affichée par le site",
    example: "Ep. à Points, Opens",
  })
  category!: string | null;

  @ApiProperty({
    description:
      "Adresse https de l'export (page de la compétition), sur le site autorisé : à passer à `/competitions/:id/results/import/topturnier-url`",
    example:
      "https://chairperson.ddsbagnols.com/resultats/20261017_exempleville/index.htm",
  })
  exportUrl!: string;

  @ApiProperty({ type: TopTurnierCompetitionMatchDto })
  match!: TopTurnierCompetitionMatchDto;

  @ApiProperty({
    description:
      "true : la compétition rapprochée (MATCHED) a déjà des résultats dans l'app",
  })
  resultsAlreadyImported!: boolean;
}

export class TopTurnierCompetitionsDto {
  @ApiProperty({
    type: [Number],
    description: "Années lues sur le site",
    example: [2026, 2025],
  })
  years!: number[];

  @ApiProperty({
    type: [TopTurnierCompetitionItemDto],
    description: "Compétitions listées, plus récentes d'abord",
  })
  items!: TopTurnierCompetitionItemDto[];

  @ApiProperty({
    description: "true : la liste du site dépassait le plafond lu par année",
  })
  truncated!: boolean;
}

export class TopTurnierIndexStatusDto {
  @ApiProperty({
    description:
      "true : la lecture de la liste des compétitions récentes est disponible sur cet environnement (aucune requête vers le site)",
  })
  enabled!: boolean;
}
