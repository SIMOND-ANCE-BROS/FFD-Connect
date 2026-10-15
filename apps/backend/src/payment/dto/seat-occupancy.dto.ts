import { ApiProperty } from "@nestjs/swagger";

export type SeatElementMode = "numbered" | "free";

/**
 * Occupancy of one layout element (#454). Seat indexes and counts only:
 * never who booked a seat, nor any booking or payment identifier.
 */
export class SeatElementOccupancyDto {
  @ApiProperty({
    example: "table-8",
    description: "Identifiant de l'élément dans le plan (`layout[].id`).",
  })
  itemId!: string;

  @ApiProperty({
    enum: ["numbered", "free"],
    example: "numbered",
    description:
      "`numbered` : places numérotées (table, gradin), choisies par `seatIndex`. " +
      "`free` : placement libre, seuls les compteurs ont un sens (les tableaux d'indices restent vides).",
  })
  mode!: SeatElementMode;

  @ApiProperty({
    example: 5,
    description:
      "Places encore réservables (hors places verrouillées, payées ou en attente de paiement).",
  })
  available!: number;

  @ApiProperty({
    example: 2,
    description: "Nombre de places payées (réservations confirmées).",
  })
  taken!: number;

  @ApiProperty({
    example: 1,
    description:
      "Nombre de places en attente de paiement (réservation non expirée).",
  })
  held!: number;

  @ApiProperty({
    example: 1,
    description:
      "Nombre de places payées ou en attente de l'utilisateur connecté (0 sans authentification).",
  })
  mine!: number;

  @ApiProperty({
    type: [Number],
    example: [0, 3],
    description: "Élément numéroté : indices des places payées.",
  })
  takenSeats!: number[];

  @ApiProperty({
    type: [Number],
    example: [4],
    description:
      "Élément numéroté : indices des places en attente de paiement (non expirées).",
  })
  heldSeats!: number[];

  @ApiProperty({
    type: [Number],
    example: [4],
    description:
      "Élément numéroté : indices des places de l'utilisateur connecté, parmi `takenSeats` et `heldSeats`.",
  })
  mySeats!: number[];

  @ApiProperty({
    example: false,
    description:
      "Une réservation antérieure à la vente à la place occupe tout l'élément : plus aucune place réservable.",
  })
  wholeElementBooked!: boolean;
}

export class SeatOccupancyResponseDto {
  @ApiProperty({ example: "comp-uuid" })
  competitionId!: string;

  @ApiProperty({
    type: [SeatElementOccupancyDto],
    description:
      "Un élément par élément réservable du plan, dans l'ordre du plan. Les places verrouillées restent celles du plan (`lockedSeats`).",
  })
  elements!: SeatElementOccupancyDto[];
}
