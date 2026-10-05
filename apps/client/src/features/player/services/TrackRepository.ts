export interface Track {
  id: string;
  title: string;
  artist: string;
  filename: string;
  bpm: number;
  artwork?: string;
  style?: string;
  /** Modération admin — le titre est masqué. Le backend renvoie le vrai titre
   *  aux admins avec ce flag à true, un libellé neutre aux non-admins. */
  titleMasked?: boolean;
  /** Paso doble : timecodes (secondes) des appels/coups, édités par un admin (#paso-clashes). */
  clashTimecodes?: number[];
}

export interface TracksPageResponse {
  tracks: Track[];
  hasMore: boolean;
  total: number;
}

export interface TrackRepository {
  getAllTracks(): Promise<Track[]>;
  getTracksPage(skip: number, take: number): Promise<TracksPageResponse>;
  getTrackUrl(filename?: string | null): string;
  getArtworkUrl(artworkFilename?: string | null): string | undefined;
  addTrack(track: Partial<Track>): Promise<void>;
}
