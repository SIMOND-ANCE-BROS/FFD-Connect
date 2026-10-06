import { Prisma, TrackCorrectionReason } from "@prisma/client";
import { publicTrackName } from "../tracks/track-visibility.util";
import {
  trackCorrectionAdminSelect,
  trackCorrectionMineSelect,
} from "../utils/prisma-selects";
import {
  MyTrackCorrectionDto,
  TrackCorrectionAdminDto,
  TrackCorrectionProposalDto,
  TrackCorrectionUserDto,
} from "./dto/track-correction-response.dto";

export type TrackCorrectionAdminRow = Prisma.TrackCorrectionGetPayload<{
  select: typeof trackCorrectionAdminSelect;
}>;

export type TrackCorrectionMineRow = Prisma.TrackCorrectionGetPayload<{
  select: typeof trackCorrectionMineSelect;
}>;

/** Champs « proposés » d'une ligne, quelle que soit la vue. */
type ProposalFields = Pick<
  TrackCorrectionAdminRow,
  | "proposedTitle"
  | "proposedArtist"
  | "proposedStyle"
  | "proposedBpm"
  | "proposesClashes"
  | "proposedClashTimecodes"
>;

/** Libellés FR des motifs, affichés dans les notifications. */
export const TRACK_CORRECTION_REASON_LABELS: Readonly<
  Record<TrackCorrectionReason, string>
> = {
  [TrackCorrectionReason.TITLE]: "Titre",
  [TrackCorrectionReason.ARTIST]: "Artiste",
  [TrackCorrectionReason.DANCE]: "Danse (catégorie)",
  [TrackCorrectionReason.MPM]: "MPM",
  [TrackCorrectionReason.PASO_CLASH]: "Clash paso doble",
  [TrackCorrectionReason.OTHER]: "Autre",
};

/** « Prénom Nom », sans espace parasite si l'un des deux est vide. */
export const formatUserName = (user: {
  firstName: string;
  lastName: string;
}): string => `${user.firstName.trim()} ${user.lastName.trim()}`.trim();

const toUser = (
  user: { id: string; firstName: string; lastName: string } | null,
): TrackCorrectionUserDto | null =>
  user ? { id: user.id, name: formatUserName(user) } : null;

export const toProposal = (
  row: ProposalFields,
): TrackCorrectionProposalDto => ({
  title: row.proposedTitle,
  artist: row.proposedArtist,
  style: row.proposedStyle,
  bpm: row.proposedBpm,
  clashTimecodes: row.proposesClashes ? row.proposedClashTimecodes : null,
});

export const toAdminDto = (
  row: TrackCorrectionAdminRow,
): TrackCorrectionAdminDto => ({
  id: row.id,
  trackId: row.trackId,
  reason: row.reason,
  status: row.status,
  proposed: toProposal(row),
  message: row.message,
  reviewComment: row.reviewComment,
  reviewedAt: row.reviewedAt,
  createdAt: row.createdAt,
  track: row.track,
  proposer: toUser(row.proposedBy),
  reviewer: toUser(row.reviewedBy),
});

/**
 * Vue de l'auteur (non-admin). Nom de la piste filtré par publicTrackName :
 * libellé neutre si le titre est masqué, rien si la piste est blacklistée.
 */
export const toMineDto = (
  row: TrackCorrectionMineRow,
): MyTrackCorrectionDto => ({
  id: row.id,
  trackId: row.trackId,
  reason: row.reason,
  status: row.status,
  proposed: toProposal(row),
  message: row.message,
  reviewComment: row.reviewComment,
  reviewedAt: row.reviewedAt,
  createdAt: row.createdAt,
  trackTitle: publicTrackName(row.track).title,
  trackArtist: publicTrackName(row.track).artist,
});
