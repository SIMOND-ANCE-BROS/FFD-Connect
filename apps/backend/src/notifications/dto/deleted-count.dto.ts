import { ApiProperty } from "@nestjs/swagger";

/**
 * Résultat d'une suppression en lot.
 *
 * Existe pour que le contrat soit TYPÉ et non décrit par un simple exemple :
 * un `schema: { example: { count: 12 } }` produit un `unknown` dans le client
 * généré, que l'appelant doit alors recaster à la main — exactement ce que la
 * génération est censée éviter.
 */
export class DeletedCountDto {
  @ApiProperty({
    description: "Nombre de notifications effectivement supprimées",
    example: 12,
  })
  count!: number;
}
