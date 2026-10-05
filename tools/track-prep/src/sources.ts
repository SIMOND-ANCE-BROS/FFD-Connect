/** Classification des liens et clés de déduplication (miroir backend). */

export type UrlKind =
  | { type: 'youtube-video'; id: string }
  | { type: 'youtube-playlist'; id: string }
  | { type: 'spotify-track'; id: string }
  | { type: 'spotify-collection'; kind: 'playlist' | 'album'; id: string }
  | { type: 'unsupported' };

/** Une unité de téléchargement : soit un lien direct, soit une recherche YouTube. */
export interface DownloadSpec {
  /** "direct" = lien YouTube ; "search" = requête `ytsearch1:` (titres Spotify). */
  kind: 'direct' | 'search';
  /** URL YouTube (direct) ou requête "Artiste - Titre" (search). */
  target: string;
  /** URL canonique du titre (trace de provenance). */
  sourceUrl: string;
  /** Clé de dédup, même format que le backend ("youtube:<id>", "spotify:<id>"). */
  sourceKey: string | null;
  /** Métadonnées connues d'avance (Spotify) — prioritaires sur celles de YouTube. */
  presetMeta: { title: string; artist: string } | null;
  /** Libellé canonique de la danse ("Samba", "Valse Lente"…) ou null. */
  style: string | null;
  /** Provenance du style quand il est connu avant téléchargement. */
  styleSource: 'option' | 'playlist' | null;
  /** Lien fourni par l'utilisateur (pour les logs). */
  origin: string;
}

export function classifyUrl(url: string): UrlKind {
  const ytPlaylist = url.match(/(?:youtube\.com|music\.youtube\.com)\/playlist\?.*?list=([\w-]+)/i);
  if (ytPlaylist) return { type: 'youtube-playlist', id: ytPlaylist[1] };

  const ytVideo = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([\w-]{11})/i,
  );
  if (ytVideo) return { type: 'youtube-video', id: ytVideo[1] };

  const spotifyTrack = url.match(/spotify\.com\/(?:[a-z-]+\/)?track\/([A-Za-z0-9]+)/i);
  if (spotifyTrack) return { type: 'spotify-track', id: spotifyTrack[1] };

  const spotifyCollection = url.match(
    /spotify\.com\/(?:[a-z-]+\/)?(playlist|album)\/([A-Za-z0-9]+)/i,
  );
  if (spotifyCollection) {
    return {
      type: 'spotify-collection',
      kind: spotifyCollection[1].toLowerCase() as 'playlist' | 'album',
      id: spotifyCollection[2],
    };
  }

  return { type: 'unsupported' };
}

/**
 * Clé provider:id pour la déduplication — même format que Track.sourceKey
 * (l'import par URL ayant été retiré du backend, l'outil est désormais le
 * seul producteur de ces clés).
 */
export function normalizeSourceKey(url: string): string | null {
  const yt = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([\w-]{11})/i,
  );
  if (yt) return `youtube:${yt[1]}`;

  const spotify = url.match(/spotify\.com\/(?:[a-z-]+\/)?track\/([A-Za-z0-9]+)/i);
  if (spotify) return `spotify:${spotify[1]}`;

  const deezer = url.match(/deezer\.com\/(?:[a-z]+\/)?track\/(\d+)/i);
  if (deezer) return `deezer:${deezer[1]}`;

  return null;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function spotifyTrackUrl(id: string): string {
  return `https://open.spotify.com/track/${id}`;
}
