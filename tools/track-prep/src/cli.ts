/** Analyse des arguments du CLI (sans dépendance externe). */
import { canonicalStyleLabel, DANCE_LABELS } from './mpm.js';

export interface CliInput {
  url: string;
  /** Libellé canonique de la danse pour ce lien, ou null. */
  style: string | null;
}

export interface CliOptions {
  inputs: CliInput[];
  outDir: string;
  /** Nombre maximal de titres extraits par playlist. */
  limit: number;
  cookies?: string;
  /** Désactive la dédup métier (même artiste + titre) à la préparation. */
  allowDuplicates: boolean;
  /** Détection auto de la danse (playlist, titre, tempo) sans --style. */
  autoStyle: boolean;
  help: boolean;
}

export const USAGE = `track-prep — prépare des titres Spotify/YouTube pour FFD-Connect

Usage :
  pnpm track-prep [options] <lien ...>

Liens acceptés :
  - Titre YouTube        https://www.youtube.com/watch?v=...  /  https://youtu.be/...
  - Playlist YouTube     https://www.youtube.com/playlist?list=...
  - Titre Spotify        https://open.spotify.com/track/...
  - Playlist / album     https://open.spotify.com/playlist/...  /  .../album/...

Options :
  --style <danse>    Danse appliquée aux liens qui suivent (répétable).
                     Danses : ${DANCE_LABELS.join(', ')}
  --out <dossier>    Dossier de sortie (défaut : ./prepared-tracks)
  --limit <n>        Titres max par playlist (défaut : 100)
  --cookies <file>   cookies.txt (format Netscape) pour l'anti-bot YouTube
  --allow-duplicates Prépare aussi les titres dont (artiste + titre) sont déjà
                     dans le manifeste via une autre source (dédup métier)
  --no-auto-style    Désactive la détection automatique de la danse. Sans
                     --style, l'outil essaie dans l'ordre : nom de la
                     playlist, titre du morceau, tempo détecté. Si le tempo
                     reste ambigu (plages BPM qui se recouvrent), les danses
                     candidates sont listées dans le récapitulatif et le
                     manifeste, à trancher à la main.
  -h, --help         Affiche cette aide

Exemples :
  pnpm track-prep --style Samba https://open.spotify.com/playlist/37i9dQ...
  pnpm track-prep --style Tango https://youtu.be/abc --style Jive https://youtu.be/def
  pnpm track-prep https://www.youtube.com/playlist?list=PL123

Synchronisation avec la base de staging :
  pnpm track-prep sync [options]     (voir : pnpm track-prep sync --help)
`;

export const SYNC_USAGE = `track-prep sync — synchronise le dossier préparé avec la base de staging

Compare le manifest.json local avec la table Track de staging, puis applique :
  + créations      titres du manifeste absents de la base (fichiers envoyés
                   vers le blob Azure et/ou le dossier uploads/ du backend)
  ~ modifications  métadonnées modifiées dans le manifeste (titre, artiste,
                   danse, MPM…)
  - suppressions   mp3 supprimés localement (ou retirés du manifeste)

Seules les lignes créées par l'outil (jobId = "track-prep") sont modifiées ou
supprimées ; un titre ajouté via l'app n'est jamais touché.

Usage :
  pnpm track-prep sync [options]

L'app ne peut pas ajouter de musique (l'outil est la seule porte d'entrée)
mais peut modifier titre/artiste/MPM/danse ou supprimer. Ces actions sont
protégées (merge à trois voies) :
  - champ modifié dans l'app seulement → préservé et rapatrié dans le manifeste ;
  - champ modifié des deux côtés → conflit signalé, ignoré sans --force ;
  - titre supprimé dans l'app → non recréé sans --force ;
  - suppression locale d'un titre modifié dans l'app → bloquée sans --force ;
  - ligne préexistante (même source, ancienne ingestion) → adoptée : ses
    métadonnées font foi, ses fichiers sont alignés sur le local.

Options :
  --apply               Exécute le plan (défaut : simulation / dry-run)
  --no-delete           Ignore les suppressions
  --force               Écrase les conflits et suppressions/recréations
                        protégées (le manifeste local gagne)
  --allow-duplicates    Autorise les doublons métier (même artiste + titre
                        déjà présents en base via une autre source)
  --out <dossier>       Dossier préparé (défaut : ./prepared-tracks)
  --database-url <url>  URL Postgres de staging
                        (défaut : STAGING_DATABASE_URL puis DATABASE_URL)
  --uploads-dir <dir>   Dossier uploads/ du backend (staging local/docker)
  -h, --help            Affiche cette aide

Environnement :
  STAGING_DATABASE_URL / DATABASE_URL      connexion Postgres
  AZURE_STORAGE_CONNECTION_STRING          blob Azure (ou AZURE_STORAGE_ACCOUNT_NAME)
  AZURE_STORAGE_CONTAINER                  conteneur blob (défaut : "tracks")
`;

export interface SyncCliOptions {
  outDir: string;
  apply: boolean;
  withDeletes: boolean;
  force: boolean;
  allowDuplicates: boolean;
  databaseUrl?: string;
  uploadsDir?: string;
  help: boolean;
}

export function parseSyncArgs(argv: string[]): SyncCliOptions {
  const options: SyncCliOptions = {
    outDir: 'prepared-tracks',
    apply: false,
    withDeletes: true,
    force: false,
    allowDuplicates: false,
    help: false,
  };

  let i = 0;
  const takeValue = (flag: string): string => {
    i += 1;
    const value = argv[i];
    if (value == null || value.startsWith('--')) {
      throw new Error(`L'option ${flag} attend une valeur`);
    }
    return value;
  };

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--no-delete') {
      options.withDeletes = false;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--allow-duplicates') {
      options.allowDuplicates = true;
    } else if (arg === '--out') {
      options.outDir = takeValue('--out');
    } else if (arg === '--database-url') {
      options.databaseUrl = takeValue('--database-url');
    } else if (arg === '--uploads-dir') {
      options.uploadsDir = takeValue('--uploads-dir');
    } else {
      throw new Error(`Option inconnue pour sync : ${arg}`);
    }
    i += 1;
  }

  return options;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputs: [],
    outDir: 'prepared-tracks',
    limit: 100,
    allowDuplicates: false,
    autoStyle: true,
    help: false,
  };

  let currentStyle: string | null = null;
  let i = 0;

  const takeValue = (flag: string): string => {
    i += 1;
    const value = argv[i];
    if (value == null || value.startsWith('--')) {
      throw new Error(`L'option ${flag} attend une valeur`);
    }
    return value;
  };

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--style') {
      const raw = takeValue('--style');
      const label = canonicalStyleLabel(raw);
      if (label == null) {
        throw new Error(`Danse inconnue : "${raw}". Danses valides : ${DANCE_LABELS.join(', ')}`);
      }
      currentStyle = label;
    } else if (arg === '--out') {
      options.outDir = takeValue('--out');
    } else if (arg === '--limit') {
      const raw = takeValue('--limit');
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`--limit attend un entier positif (reçu "${raw}")`);
      }
      options.limit = n;
    } else if (arg === '--cookies') {
      options.cookies = takeValue('--cookies');
    } else if (arg === '--allow-duplicates') {
      options.allowDuplicates = true;
    } else if (arg === '--no-auto-style') {
      options.autoStyle = false;
    } else if (arg.startsWith('-') && !/^https?:\/\//i.test(arg)) {
      throw new Error(`Option inconnue : ${arg}`);
    } else {
      options.inputs.push({ url: arg, style: currentStyle });
    }
    i += 1;
  }

  return options;
}
