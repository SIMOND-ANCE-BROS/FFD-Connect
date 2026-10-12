import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { MAX_ELEMENT_SEATS } from "../seat-layout";

export class CreateCheckoutDto {
  @ApiProperty({ example: "comp-uuid" })
  @IsString()
  @IsNotEmpty()
  competitionId!: string;

  @ApiProperty({ example: "item-uuid" })
  @IsString()
  @IsNotEmpty()
  itemId!: string;

  /**
   * Seat chosen on a numbered element (#428): `TABLE` → 0..capacity-1,
   * `GRADIN` → row * cols + col. Omitted: the server picks the first free
   * seat (or a place of a free-placement element, which takes no index).
   */
  @ApiPropertyOptional({
    example: 4,
    minimum: 0,
    maximum: MAX_ELEMENT_SEATS - 1,
    description:
      "Indice de la place sur l'élément numéroté (table : 0 à capacité-1 ; gradin : rang × colonnes + colonne). " +
      "Absent : le serveur attribue la première place libre. Interdit sur un élément en placement libre.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ELEMENT_SEATS - 1)
  seatIndex?: number;

  @ApiPropertyOptional({
    example: "Rang A, Place 5",
    description:
      "Libellé d'affichage, jamais utilisé pour identifier la place.",
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  seatLabel?: string;

  /**
   * Ignored (#381): the amount is computed server-side from the competition
   * layout. Still accepted so that older clients sending it are not rejected
   * by the global `forbidNonWhitelisted` validation.
   */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "Ignoré : le montant est calculé côté serveur à partir du tarif de la place.",
    example: 1500,
  })
  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class CheckoutResponseDto {
  @ApiProperty({ example: 12345, description: "Id HelloAsso du checkout" })
  id!: number;

  @ApiProperty({
    example: "https://www.helloasso.com/...",
    description:
      "Page de paiement HelloAsso (valable 15 minutes après sa création).",
  })
  redirectUrl!: string;

  @ApiProperty({ example: "booking-uuid" })
  bookingId!: string;

  @ApiProperty({
    example: 4,
    nullable: true,
    type: Number,
    description:
      "Place attribuée (élément numéroté) ; null en placement libre.",
  })
  seatIndex!: number | null;

  @ApiProperty({
    description: "Fin de la retenue de la place si le paiement n'aboutit pas.",
  })
  expiresAt!: Date;

  @ApiProperty({
    description:
      "true : reprise d'une réservation en attente de l'utilisateur sur cette place.",
  })
  resumed!: boolean;
}
