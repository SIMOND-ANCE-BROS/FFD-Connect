import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Piste audio telle que renvoyée par les endpoints de lecture de la
 * bibliothèque (même forme que `TRACK_BASE_SELECT` dans tracks.service.ts).
 *
 * Le titre est déjà masqué (« Titre masqué ») pour un non-admin lorsque
 * `titleMasked` est vrai. Le flux audio se télécharge via
 * `GET /tracks/download/{filename}`.
 */
export class TrackResponseDto {
  @ApiProperty({ description: "UUID de la piste" })
  id!: string;

  @ApiProperty({
    description: "Titre (masqué pour un non-admin si titleMasked)",
  })
  title!: string;

  @ApiProperty({ description: "Artiste", example: "Ambiance" })
  artist!: string;

  @ApiProperty({
    description:
      "Nom du fichier audio — à passer à GET /tracks/download/{token}",
  })
  filename!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  artwork!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Danse / style",
    example: "Ambiance",
  })
  style!: string | null;

  @ApiProperty({ description: "Tempo en MPM (mesures par minute)" })
  bpm!: number;

  @ApiProperty({ description: "Tempo brut détecté (BPM)" })
  rawBpm!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  submittedById!: string | null;

  @ApiProperty({ description: "Titre masqué côté non-admin" })
  titleMasked!: boolean;

  @ApiProperty({ description: "Piste retirée de la bibliothèque (admin)" })
  blacklisted!: boolean;

  @ApiProperty({
    type: [Number],
    description: "Paso doble : timecodes (secondes) des appels",
  })
  clashTimecodes!: number[];

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;
}
