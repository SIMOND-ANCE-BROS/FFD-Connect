import { ApiProperty } from "@nestjs/swagger";

/** Épreuve d'un résultat publié (sous-ensemble de l'épreuve). */
export class CompetitionResultEventDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id!: string;

  @ApiProperty({ example: "Latines" })
  category!: string;

  @ApiProperty({ example: "Adultes" })
  ageGroup!: string;
}

/**
 * Ligne de `GET /competitions/:id/results` (endpoint public). Ne porte
 * jamais l'identifiant du compte du couple (#413) : le classement officiel se
 * lit avec `details.participant`, publié par l'organisateur.
 */
export class CompetitionResultDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id!: string;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440001" })
  eventId!: string;

  @ApiProperty({ example: "Finale" })
  round!: string;

  @ApiProperty({ example: 1 })
  ranking!: number;

  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description:
      "Détails publiés du classement (liste blanche) : participant / name (nom du couple), club, bib (dossard), status (QUALIFIED / ELIMINATED), marks, totalParticipants. Toujours un objet.",
    example: { participant: "Martin / Durand", status: "QUALIFIED", marks: 5 },
  })
  details!: Record<string, unknown>;

  @ApiProperty({ type: CompetitionResultEventDto })
  event!: CompetitionResultEventDto;
}
