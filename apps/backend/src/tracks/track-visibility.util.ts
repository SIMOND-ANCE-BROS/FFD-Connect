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
