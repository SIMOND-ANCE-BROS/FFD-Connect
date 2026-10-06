import { ApiProperty } from "@nestjs/swagger";
import { TrackCorrectionReason, TrackCorrectionStatus } from "@prisma/client";

/**
 * Valeurs proposées. `null` = pas de proposition sur ce champ ;
 * `clashTimecodes: []` = proposition « aucun clash », distincte de `null`.
 */
export class TrackCorrectionProposalDto {
  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: String, nullable: true })
  artist!: string | null;

  @ApiProperty({ type: String, nullable: true })
  style!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: "MPM proposé" })
  bpm!: number | null;

  @ApiProperty({
    type: [Number],
    nullable: true,
    description: "Timecodes de clash proposés (secondes), triés",
  })
  clashTimecodes!: number[] | null;
}

/** Valeurs ACTUELLES de la piste, pour afficher le diff. */
export class TrackCorrectionTrackSnapshotDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  artist!: string;

  @ApiProperty({ type: String, nullable: true })
  style!: string | null;

  @ApiProperty({ description: "MPM actuel" })
  bpm!: number;

  @ApiProperty({ type: [Number] })
  clashTimecodes!: number[];

  @ApiProperty()
  titleMasked!: boolean;

  @ApiProperty()
  blacklisted!: boolean;
}

/** Utilisateur nommé (auteur ou relecteur), sans e-mail. */
export class TrackCorrectionUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "Prénom Nom", example: "Jeanne Martin" })
  name!: string;
}

/** Champs communs à toutes les vues d'une proposition. */
class TrackCorrectionCommonDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  trackId!: string;

  @ApiProperty({
    enum: TrackCorrectionReason,
    enumName: "TrackCorrectionReason",
  })
  reason!: TrackCorrectionReason;

  @ApiProperty({
    enum: TrackCorrectionStatus,
    enumName: "TrackCorrectionStatus",
  })
  status!: TrackCorrectionStatus;

  @ApiProperty({ type: TrackCorrectionProposalDto })
  proposed!: TrackCorrectionProposalDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Commentaire de l'auteur",
  })
  message!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Commentaire de l'administrateur",
  })
  reviewComment!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  reviewedAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;
}

/** Proposition vue par un administrateur (file de modération). */
export class TrackCorrectionAdminDto extends TrackCorrectionCommonDto {
  @ApiProperty({ type: TrackCorrectionTrackSnapshotDto })
  track!: TrackCorrectionTrackSnapshotDto;

  @ApiProperty({
    type: TrackCorrectionUserDto,
    nullable: true,
    description: "Null si le compte de l'auteur a été supprimé",
  })
  proposer!: TrackCorrectionUserDto | null;

  @ApiProperty({
    type: TrackCorrectionUserDto,
    nullable: true,
    description: "Null tant que la proposition est en attente",
  })
  reviewer!: TrackCorrectionUserDto | null;
}

/** Proposition vue par son auteur (« Mes propositions »). */
export class MyTrackCorrectionDto extends TrackCorrectionCommonDto {
  @ApiProperty({
    description: "Titre de la piste (libellé neutre si la piste est masquée)",
  })
  trackTitle!: string;

  @ApiProperty()
  trackArtist!: string;
}

/** Métadonnées de pagination (cf. createPaginatedResponse). */
export class TrackCorrectionPageMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  take!: number;

  @ApiProperty()
  hasMore!: boolean;
}

export class TrackCorrectionAdminPageDto {
  @ApiProperty({ type: [TrackCorrectionAdminDto] })
  data!: TrackCorrectionAdminDto[];

  @ApiProperty({ type: TrackCorrectionPageMetaDto })
  meta!: TrackCorrectionPageMetaDto;
}

export class MyTrackCorrectionPageDto {
  @ApiProperty({ type: [MyTrackCorrectionDto] })
  data!: MyTrackCorrectionDto[];

  @ApiProperty({ type: TrackCorrectionPageMetaDto })
  meta!: TrackCorrectionPageMetaDto;
}

/** Nombre de propositions en attente (badge admin). */
export class TrackCorrectionPendingCountDto {
  @ApiProperty({ example: 3 })
  count!: number;
}
