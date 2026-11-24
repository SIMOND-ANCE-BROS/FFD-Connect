import type { DanceCapability } from "@ffd-connect/shared";
import { ApiProperty } from "@nestjs/swagger";
import { KNOWN_DANCE_CAPABILITIES } from "../dance-capabilities";

/** A discipline (style) of a dance domain (#1022, ADR-0026). */
export class DisciplineCatalogItemDto {
  @ApiProperty({
    example: "LATIN",
    description:
      "Code stable de la discipline, clé utilisée par le code et les API",
  })
  code!: string;

  @ApiProperty({
    example: "Danses latines",
    description: "Libellé français, pour l'affichage seulement",
  })
  label!: string;

  @ApiProperty({
    type: [String],
    example: ["latin", "latins", "latine", "latines"],
    description:
      "Saisies libres et imports reconnus pour cette discipline, normalisés : minuscules, sans accents ni caractère non alphanumérique (« 10 danses » → « 10danses »)",
  })
  aliases!: string[];
}

/** A dance domain (= a federation family of dances) and its disciplines. */
export class DanceDomainCatalogItemDto {
  @ApiProperty({
    example: "LATINES_STANDARDS",
    description: "Code stable du domaine (famille de danses)",
  })
  code!: string;

  @ApiProperty({
    example: "Latines & standards",
    description: "Libellé français, pour l'affichage seulement",
  })
  label!: string;

  @ApiProperty({
    enum: KNOWN_DANCE_CAPABILITIES,
    enumName: "DanceCapability",
    isArray: true,
    example: ["COUPLE", "PASSPORT"],
    description:
      "Fonctionnalités utilisées par le domaine. Une capacité inconnue de cette version du serveur n'est pas servie.",
  })
  capabilities!: DanceCapability[];

  @ApiProperty({
    type: [DisciplineCatalogItemDto],
    description: "Disciplines actives du domaine, dans l'ordre d'affichage",
  })
  disciplines!: DisciplineCatalogItemDto[];
}

/** Public catalog served by GET /disciplines. */
export class DisciplineCatalogDto {
  @ApiProperty({
    type: [DanceDomainCatalogItemDto],
    description:
      "Domaines de danse dans l'ordre d'affichage, même ceux sans discipline active",
  })
  domains!: DanceDomainCatalogItemDto[];
}
