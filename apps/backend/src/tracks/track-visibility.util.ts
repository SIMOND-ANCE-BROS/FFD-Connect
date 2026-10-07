import { Prisma, TrackStatus } from "@prisma/client";

/**
 * Pistes de la bibliothèque visibles par un non-admin : exclut Ambiance, les
 * pistes en cours de traitement (PENDING/ERROR) et les pistes blacklistées.
 */
export const LIBRARY_TRACK_WHERE: Prisma.TrackWhereInput = {
  AND: [
    { artist: { not: { equals: "Ambiance" }, mode: "insensitive" } },
    {
      OR: [
        { style: { not: { equals: "Ambiance" }, mode: "insensitive" } },
        { style: null },
      ],
    },
    { status: TrackStatus.READY },
    { blacklisted: false },
  ],
};

/**
 * Filtre de résolution d'une piste par ID. Un admin atteint toute piste ; un
 * non-admin uniquement celles de la bibliothèque, de sorte qu'une piste hors
 * bibliothèque soit indiscernable d'une piste inexistante (même 404).
 */
export const trackByIdWhere = (
  id: string,
  isAdmin: boolean,
): Prisma.TrackWhereInput =>
  isAdmin ? { id } : { AND: [{ id }, LIBRARY_TRACK_WHERE] };

/** Libellé neutre affiché à la place du titre réel d'une piste masquée. */
export const MASKED_TITLE_LABEL = "Titre masqué";

/**
 * Libellé affiché à la place du titre d'une piste blacklistée : retirée de la
 * bibliothèque, elle est invisible pour les non-admins (titre ET artiste).
 */
export const REMOVED_TRACK_LABEL = "Musique retirée";

/** Champs nécessaires pour décider de ce qu'un non-admin peut voir d'une piste. */
export interface TrackVisibilityFields {
  title: string;
  artist: string;
  titleMasked: boolean;
  blacklisted: boolean;
}

/**
 * Nom d'une piste tel qu'un NON-ADMIN peut le voir, partout où il apparaît
 * hors de TracksService (propositions, notifications, export RGPD) :
 * - blacklistée → ni titre ni artiste (la piste n'existe plus pour lui) ;
 * - titre masqué → libellé neutre, artiste conservé (comme
 *   TracksService.findOne(isAdmin = false)).
 */
export const publicTrackName = (
  track: TrackVisibilityFields,
): { title: string; artist: string } => {
  if (track.blacklisted) {
    return { title: REMOVED_TRACK_LABEL, artist: "" };
  }
  if (track.titleMasked) {
    return { title: MASKED_TITLE_LABEL, artist: track.artist };
  }
  return { title: track.title, artist: track.artist };
};
