/**
 * track-prep — CLI local pour préparer des titres de danse pour FFD-Connect.
 *
 * À partir de liens Spotify (titre, playlist, album) et YouTube (titre,
 * playlist) : télécharge l'audio en mp3, détecte le tempo brut (BPM),
 * calcule le MPM selon la danse choisie, nomme les fichiers à la convention
 * fédération et écrit un manifest.json récapitulatif.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import 'dotenv/config';
import { analyzeBpm } from './bpm.js';
import { parseArgs, parseSyncArgs, SYNC_USAGE, USAGE, type CliInput } from './cli.js';
import { trackSignature } from './dedupe.js';
import { downloadAudio, listYoutubePlaylist, type DownloadOptions } from './download.js';
import {
  loadManifest,
  manifestPath,
  nextTrackIndex,
  saveManifest,
  type ManifestTrack,
} from './manifest.js';
import { calculateMpm } from './mpm.js';
import { buildBasename, writeFinalMp3, type TempoInfo } from './prepare.js';
import {
  classifyUrl,
  normalizeSourceKey,
  spotifyTrackUrl,
  youtubeWatchUrl,
  type DownloadSpec,
} from './sources.js';
import { fetchSpotifyCollectionTracks, fetchSpotifyTrackMeta } from './spotify.js';
import { detectStyleFromTempo, detectStyleFromTitle } from './style-detect.js';
import { getErrorMessage, resolveFfmpeg } from './utils.js';

/**
 * Danse d'une playlist : --style si fourni, sinon (avec autoStyle) déduite
 * du nom de la playlist (« Playlist SAMBA compét » → Samba).
 */
function playlistStyle(
  input: CliInput,
  playlistTitle: string,
  autoStyle: boolean,
): { style: string | null; styleSource: 'option' | 'playlist' | null } {
  if (input.style) return { style: input.style, styleSource: 'option' };
  if (autoStyle) {
    const guess = detectStyleFromTitle(playlistTitle);
    if (guess) {
      console.log(`  ♪ Danse déduite du nom de la playlist : ${guess}`);
      return { style: guess, styleSource: 'playlist' };
    }
  }
  return { style: null, styleSource: null };
}

/** Développe un lien utilisateur en liste de titres à télécharger. */
async function expandInput(
  input: CliInput,
  limit: number,
  dlOptions: DownloadOptions,
  autoStyle: boolean,
): Promise<DownloadSpec[]> {
  const kind = classifyUrl(input.url);

  switch (kind.type) {
    case 'youtube-video': {
      const url = youtubeWatchUrl(kind.id);
      if (/[?&]list=/.test(input.url)) {
        console.log(
          '  ℹ Lien watch avec paramètre list : seul ce titre est téléchargé ' +
            '(utilisez un lien /playlist pour toute la liste)',
        );
      }
      return [
        {
          kind: 'direct',
          target: url,
          sourceUrl: url,
          sourceKey: `youtube:${kind.id}`,
          presetMeta: null,
          style: input.style,
          styleSource: input.style ? 'option' : null,
          origin: input.url,
        },
      ];
    }

    case 'youtube-playlist': {
      const playlist = await listYoutubePlaylist(input.url, limit, dlOptions);
      console.log(
        `  ↳ Playlist YouTube « ${playlist.title} » : ${playlist.entries.length} titre(s)`,
      );
      const { style, styleSource } = playlistStyle(input, playlist.title, autoStyle);
      return playlist.entries.map((entry) => ({
        kind: 'direct',
        target: youtubeWatchUrl(entry.id),
        sourceUrl: youtubeWatchUrl(entry.id),
        sourceKey: `youtube:${entry.id}`,
        presetMeta: null,
        style,
        styleSource,
        origin: input.url,
      }));
    }

    case 'spotify-track': {
      const meta = await fetchSpotifyTrackMeta(input.url);
      return [
        {
          kind: 'search',
          target: `${meta.artist} - ${meta.title}`,
          sourceUrl: spotifyTrackUrl(kind.id),
          sourceKey: `spotify:${kind.id}`,
          presetMeta: meta,
          style: input.style,
          styleSource: input.style ? 'option' : null,
          origin: input.url,
        },
      ];
    }

    case 'spotify-collection': {
      const collection = await fetchSpotifyCollectionTracks(kind.kind, kind.id);
      const kept = collection.tracks.slice(0, limit);
      console.log(
        `  ↳ ${kind.kind === 'album' ? 'Album' : 'Playlist'} Spotify « ${collection.name} » : ` +
          `${kept.length} titre(s)${collection.tracks.length > kept.length ? ` (limité à ${limit})` : ''}`,
      );
      const { style, styleSource } = playlistStyle(input, collection.name, autoStyle);
      return kept.map((track) => ({
        kind: 'search',
        target: `${track.artist} - ${track.title}`,
        sourceUrl: track.trackId ? spotifyTrackUrl(track.trackId) : input.url,
        sourceKey: track.trackId ? `spotify:${track.trackId}` : null,
        presetMeta: { title: track.title, artist: track.artist },
        style,
        styleSource,
        origin: input.url,
      }));
    }

    case 'unsupported':
      throw new Error('Lien non reconnu (attendu : titre/playlist Spotify ou YouTube)');
  }
}

/** Levée quand le titre téléchargé est un doublon métier (artiste + titre). */
class DuplicateTrackError extends Error {
  constructor(existingFilename: string) {
    super(
      `même artiste + titre déjà préparé (${existingFilename}) — --allow-duplicates pour forcer`,
    );
  }
}

async function processSpec(
  spec: DownloadSpec,
  index: number,
  outDir: string,
  tmpDir: string,
  dlOptions: DownloadOptions,
  signatures: Map<string, string> | null,
  autoStyle: boolean,
): Promise<ManifestTrack> {
  const downloaded = await downloadAudio(spec, tmpDir, `t${index}`, dlOptions);
  const meta = downloaded.metadata;

  // Dédup métier post-téléchargement (liens YouTube : les métadonnées ne
  // sont connues qu'à ce stade). Les liens Spotify sont filtrés en amont.
  if (signatures) {
    const signature = trackSignature(meta.artist, meta.title);
    const existing = signatures.get(signature);
    if (existing) {
      for (const p of [downloaded.filePath, downloaded.artworkPath]) {
        if (p && fs.existsSync(p)) fs.unlinkSync(p);
      }
      throw new DuplicateTrackError(existing);
    }
  }

  let style = spec.style;
  let styleSource: ManifestTrack['styleSource'] = spec.styleSource ?? undefined;
  let styleCandidates: string[] | undefined;

  // Détection par le titre du morceau (« Sway (Cha-cha) », « Samba de… »).
  if (!style && autoStyle) {
    const fromTitle = detectStyleFromTitle(meta.title);
    if (fromTitle) {
      style = fromTitle;
      styleSource = 'titre';
      console.log(`  ♪ Danse détectée dans le titre : ${fromTitle}`);
    }
  }

  let rawBpm = 0;
  try {
    rawBpm = await analyzeBpm(downloaded.filePath);
  } catch (error) {
    console.log(
      `  ⚠ Analyse du tempo impossible (${getErrorMessage(error)}) — tempo à corriger à la main`,
    );
  }

  // Détection par le tempo : assignée seulement si une seule danse est
  // plausible ; sinon les candidates sont listées pour arbitrage manuel.
  if (!style && autoStyle && rawBpm > 0) {
    const detection = detectStyleFromTempo(rawBpm);
    if (detection.best) {
      style = detection.best;
      styleSource = 'tempo';
      console.log(`  ♪ Danse déduite du tempo (${Math.round(rawBpm)} BPM) : ${detection.best}`);
    } else if (detection.candidates.length > 0) {
      styleCandidates = detection.candidates.map((c) => `${c.label} (${c.mpm} MPM)`);
      console.log(
        `  ? Tempo ambigu (${Math.round(rawBpm)} BPM) — candidates : ${styleCandidates.join(' ou ')}`,
      );
    }
  }

  const mpm = calculateMpm(rawBpm, style);
  const tempo: TempoInfo | null =
    rawBpm > 0
      ? style
        ? { value: mpm, unit: 'MPM' }
        : { value: Math.round(rawBpm), unit: 'BPM' }
      : null;

  const basename = buildBasename(index, style, meta.artist, meta.title, tempo);
  const finalMp3 = path.join(outDir, `${basename}.mp3`);
  await writeFinalMp3(downloaded.filePath, downloaded.artworkPath, finalMp3, {
    title: meta.title,
    artist: meta.artist,
    style,
    mpm,
  });

  let artworkName: string | null = null;
  if (downloaded.artworkPath) {
    artworkName = `${basename}.jpg`;
    fs.copyFileSync(downloaded.artworkPath, path.join(outDir, artworkName));
  }

  // Nettoyage des fichiers temporaires de ce titre.
  for (const p of [downloaded.filePath, downloaded.artworkPath]) {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  }

  return {
    filename: `${basename}.mp3`,
    artwork: artworkName,
    title: meta.title,
    artist: meta.artist,
    style,
    rawBpm: Math.round(rawBpm * 100) / 100,
    mpm,
    sourceKey: spec.sourceKey ?? normalizeSourceKey(spec.sourceUrl),
    sourceUrl: spec.sourceUrl,
    origin: spec.origin,
    preparedAt: new Date().toISOString(),
    ...(styleSource ? { styleSource } : {}),
    ...(styleCandidates ? { styleCandidates } : {}),
  };
}

async function mainSync(argv: string[]): Promise<void> {
  let options;
  try {
    options = parseSyncArgs(argv);
  } catch (error) {
    console.error(`Erreur : ${getErrorMessage(error)}\n`);
    console.error(SYNC_USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(SYNC_USAGE);
    return;
  }

  const databaseUrl =
    options.databaseUrl ?? process.env.STAGING_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      'Erreur : aucune base cible — passez --database-url ou définissez ' +
        'STAGING_DATABASE_URL / DATABASE_URL\n',
    );
    console.error(SYNC_USAGE);
    process.exitCode = 1;
    return;
  }

  const { runSync } = await import('./sync.js');
  await runSync({
    outDir: path.resolve(options.outDir),
    apply: options.apply,
    withDeletes: options.withDeletes,
    force: options.force,
    allowDuplicates: options.allowDuplicates,
    databaseUrl,
    uploadsDir: options.uploadsDir ? path.resolve(options.uploadsDir) : undefined,
  });
}

async function main(): Promise<void> {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Erreur : ${getErrorMessage(error)}\n`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help || options.inputs.length === 0) {
    console.log(USAGE);
    return;
  }

  const outDir = path.resolve(options.outDir);
  const tmpDir = path.join(outDir, `.tmp-${process.pid}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const ffmpeg = resolveFfmpeg();
  console.log(`ffmpeg : ${ffmpeg.system ? ffmpeg.path : 'binaire embarqué (@ffmpeg-installer)'}`);
  console.log(`Dossier de sortie : ${outDir}\n`);

  const dlOptions: DownloadOptions = { cookies: options.cookies };

  // 1. Développer chaque lien en liste de titres.
  const specs: DownloadSpec[] = [];
  for (const input of options.inputs) {
    console.log(`Analyse du lien : ${input.url}`);
    try {
      specs.push(...(await expandInput(input, options.limit, dlOptions, options.autoStyle)));
    } catch (error) {
      console.error(`  ✗ ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }

  // 2. Dédup : par sourceKey (même lien) et par signature métier
  //    (même artiste + titre via une autre source), dans la même exécution
  //    et contre le manifeste existant.
  const manifest = loadManifest(outDir);
  const known = new Set(manifest.tracks.map((t) => t.sourceKey).filter(Boolean));
  const signatures: Map<string, string> | null = options.allowDuplicates
    ? null
    : new Map(manifest.tracks.map((t) => [trackSignature(t.artist, t.title), t.filename]));
  const queue: DownloadSpec[] = [];
  for (const spec of specs) {
    if (spec.sourceKey && known.has(spec.sourceKey)) {
      console.log(`  ≡ Déjà préparé, ignoré : ${spec.target}`);
      continue;
    }
    // Dédup métier en amont pour les titres dont on connaît déjà les
    // métadonnées (Spotify) — évite un téléchargement inutile.
    if (signatures && spec.presetMeta) {
      const signature = trackSignature(spec.presetMeta.artist, spec.presetMeta.title);
      const existing = signatures.get(signature);
      if (existing) {
        console.log(`  ≡ Doublon métier (déjà préparé : ${existing}), ignoré : ${spec.target}`);
        continue;
      }
      signatures.set(signature, spec.target);
    }
    if (spec.sourceKey) known.add(spec.sourceKey);
    queue.push(spec);
  }

  if (queue.length === 0) {
    console.log('\nRien à télécharger.');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return;
  }

  console.log(`\n${queue.length} titre(s) à préparer\n`);

  // 3. Télécharger + analyser + finaliser, séquentiellement.
  let index = nextTrackIndex(outDir);
  const prepared: ManifestTrack[] = [];
  const skippedDuplicates: string[] = [];
  const failures: { spec: DownloadSpec; error: string }[] = [];
  let position = 0;

  for (const spec of queue) {
    position += 1;
    const label = spec.presetMeta
      ? `${spec.presetMeta.artist} - ${spec.presetMeta.title}`
      : spec.target;
    console.log(`→ [${position}/${queue.length}] ${label}`);
    try {
      const entry = await processSpec(
        spec,
        index,
        outDir,
        tmpDir,
        dlOptions,
        signatures,
        options.autoStyle,
      );
      signatures?.set(trackSignature(entry.artist, entry.title), entry.filename);
      prepared.push(entry);
      manifest.tracks.push(entry);
      saveManifest(outDir, manifest); // sauvegarde incrémentale
      index += 1;
      const autoNote =
        entry.styleSource === 'titre' || entry.styleSource === 'tempo'
          ? entry.styleSource === 'titre'
            ? ' — auto (titre)'
            : ' — auto (tempo), à vérifier'
          : entry.styleSource === 'playlist'
            ? ' — auto (playlist)'
            : '';
      const tempoLabel = entry.style
        ? `${entry.mpm} MPM (${entry.style}${autoNote}, BPM brut ${entry.rawBpm})`
        : `${entry.mpm} BPM (danse non précisée)`;
      console.log(`  ✓ ${entry.filename}`);
      console.log(`    ${tempoLabel}`);
    } catch (error) {
      if (error instanceof DuplicateTrackError) {
        skippedDuplicates.push(label);
        console.log(`  ≡ Doublon métier, ignoré : ${error.message}`);
        continue;
      }
      const message = getErrorMessage(error);
      failures.push({ spec, error: message });
      console.error(`  ✗ Échec : ${message}`);
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  // 4. Récapitulatif.
  console.log(`\n─── Récapitulatif ───`);
  console.log(`Préparés : ${prepared.length} / ${queue.length}`);
  if (skippedDuplicates.length > 0) {
    console.log(`Doublons métier ignorés : ${skippedDuplicates.length}`);
  }
  for (const entry of prepared) {
    console.log(`  ${entry.filename}${entry.style ? `  [${entry.style} — ${entry.mpm} MPM]` : ''}`);
  }
  const toClassify = prepared.filter((e) => !e.style && e.styleCandidates?.length);
  if (toClassify.length > 0) {
    console.log(`À classer manuellement (tempo ambigu) : ${toClassify.length}`);
    for (const entry of toClassify) {
      console.log(`  ? ${entry.filename}`);
      console.log(`    candidates : ${(entry.styleCandidates ?? []).join(' ou ')}`);
    }
    console.log(`  → renseignez "style" et "mpm" dans le manifeste puis relancez la sync`);
  }
  if (failures.length > 0) {
    console.log(`Échecs : ${failures.length}`);
    for (const failure of failures) {
      console.log(`  ${failure.spec.target} → ${failure.error}`);
    }
    process.exitCode = 1;
  }
  console.log(`\nManifeste : ${manifestPath(outDir)}`);
}

const entry = process.argv[2] === 'sync' ? mainSync(process.argv.slice(3)) : main();

entry.catch((error: unknown) => {
  console.error(`Erreur fatale : ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
