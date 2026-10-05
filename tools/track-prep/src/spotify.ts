/**
 * Métadonnées Spotify sans identifiants API :
 *  - titre seul : scraping des balises og: (même approche que l'ancien
 *    pipeline d'import du backend, retiré depuis) ;
 *  - playlist/album : page embed (open.spotify.com/embed/...) dont le JSON
 *    __NEXT_DATA__ contient la liste des titres.
 */
import { withTimeout } from './utils.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36';

const FETCH_TIMEOUT_MS = 20_000;

export interface SpotifyTrackMeta {
  title: string;
  artist: string;
  /** Id Spotify du titre quand il est connu (entrées de playlist/album). */
  trackId: string | null;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await withTimeout(
    fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    }),
    FETCH_TIMEOUT_MS,
    `Requête Spotify (${url})`,
  );
  if (!response.ok) {
    throw new Error(`Spotify a répondu ${response.status} pour ${url}`);
  }
  return response.text();
}

/** Décode les entités HTML courantes des balises og:. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Métadonnées d'un titre Spotify via les balises og: de la page publique. */
export async function fetchSpotifyTrackMeta(
  url: string,
): Promise<{ title: string; artist: string }> {
  const html = await fetchHtml(url);

  const titleMatch = html.match(/<meta property="og:title" content="(.*?)"/);
  const descMatch = html.match(/<meta property="og:description" content="(.*?)"/);
  if (!titleMatch || !descMatch) {
    throw new Error('Impossible de lire les métadonnées de la page Spotify');
  }

  const title = decodeEntities(titleMatch[1]);
  // Format historique : "Artist · Album · Song · Year" (même parsing que le backend).
  const artist = decodeEntities(descMatch[1].split(' · ')[0]);
  return { title, artist };
}

/** Recherche récursive d'une clé dans un JSON de structure inconnue. */
function findKey(value: unknown, key: string): unknown {
  if (value == null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (key in record) return record[key];
  for (const nested of Object.values(record)) {
    const found = findKey(nested, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

interface EmbedTrackItem {
  title?: unknown;
  subtitle?: unknown;
  uri?: unknown;
}

/**
 * Liste les titres d'une playlist ou d'un album Spotify via la page embed.
 * Attention : Spotify tronque cette liste (~100 titres max) ; le CLI signale
 * la troncature à l'utilisateur.
 */
export async function fetchSpotifyCollectionTracks(
  kind: 'playlist' | 'album',
  id: string,
): Promise<{ name: string; tracks: SpotifyTrackMeta[] }> {
  const embedUrl = `https://open.spotify.com/embed/${kind}/${id}`;
  const html = await fetchHtml(embedUrl);

  const jsonMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]+?)<\/script>/,
  );
  if (!jsonMatch) {
    throw new Error(
      `Structure de la page embed Spotify inattendue pour ${embedUrl} — ` +
        'passez les liens des titres individuellement',
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(jsonMatch[1]);
  } catch {
    throw new Error(`JSON embed Spotify illisible pour ${embedUrl}`);
  }

  const trackList = findKey(data, 'trackList');
  if (!Array.isArray(trackList) || trackList.length === 0) {
    throw new Error(
      `Aucune liste de titres trouvée dans l'embed Spotify ${embedUrl} — ` +
        'la playlist est peut-être privée ; passez les liens des titres individuellement',
    );
  }

  const name = (findKey(data, 'name') as string | undefined) ?? `${kind} ${id}`;

  const tracks: SpotifyTrackMeta[] = [];
  for (const item of trackList as EmbedTrackItem[]) {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const artist = typeof item.subtitle === 'string' ? item.subtitle.trim() : '';
    if (!title) continue;
    const uriMatch =
      typeof item.uri === 'string' ? item.uri.match(/^spotify:track:([A-Za-z0-9]+)$/) : null;
    tracks.push({
      title,
      artist: artist || 'Unknown',
      trackId: uriMatch ? uriMatch[1] : null,
    });
  }

  if (tracks.length === 0) {
    throw new Error(
      `Liste de titres vide dans l'embed Spotify ${embedUrl} — ` +
        'passez les liens des titres individuellement',
    );
  }

  return { name, tracks };
}
