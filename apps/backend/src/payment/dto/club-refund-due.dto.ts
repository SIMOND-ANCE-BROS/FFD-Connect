import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** Compétition concernée par un remboursement dû. */
export class ClubRefundDueCompetitionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, format: "date-time" })
  date!: Date;
}

/** Titulaire du compte qui a payé (nom seulement, aucune coordonnée). */
export class ClubRefundDueDancerDto {
  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

/**
 * Une réservation pour laquelle le club organisateur doit rembourser un ou
 * plusieurs paiements HelloAsso (#428, #516) : paiement arrivé après
 * l'expiration de la réservation, sur une intention de paiement remplacée,
 * ou en double sur une place déjà payée.
 */
export class ClubRefundDueDto {
  @ApiProperty({ description: "Identifiant de la réservation de place" })
  bookingId!: string;

  @ApiProperty({ type: ClubRefundDueCompetitionDto })
  competition!: ClubRefundDueCompetitionDto;

  @ApiProperty({ type: ClubRefundDueDancerDto })
  dancer!: ClubRefundDueDancerDto;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "Numéro de la place dans son élément du plan (à partir de 1) ; null pour une réservation antérieure à la vente à la place",
  })
  seatNumber!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "Montant attendu d'UN paiement, en centimes (tarif fixé au checkout)",
  })
  amountCents!: number | null;

  @ApiProperty({
    type: [String],
    description:
      "Références HelloAsso des paiements à rembourser (identifiants d'intention de paiement), un par paiement",
  })
  helloAssoCheckoutIntentIds!: string[];

  @ApiProperty({
    type: String,
    format: "date-time",
    description: "Date à laquelle le remboursement est devenu dû",
  })
  refundOwedAt!: Date;
}

/** Métadonnées de pagination (cf. createPaginatedResponse). */
export class ClubRefundsDuePageMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  take!: number;

  @ApiProperty()
  hasMore!: boolean;
}

export class ClubRefundsDuePageDto {
  @ApiProperty({ type: [ClubRefundDueDto] })
  data!: ClubRefundDueDto[];

  @ApiProperty({ type: ClubRefundsDuePageMetaDto })
  meta!: ClubRefundsDuePageMetaDto;
}

/** Pagination of the refunds due (take ≤ 50, default 20). */
export class ListClubRefundsDueQueryDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}
