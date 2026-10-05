# track-prep — préparer des titres de danse pour FFD-Connect

CLI **local** (à lancer depuis votre PC) qui, à partir de liens **Spotify**
(titre, playlist, album) et **YouTube** (titre, playlist) :

1. télécharge l'audio en **mp3** (via yt-dlp — les liens Spotify sont
   recherchés sur YouTube avec `ytsearch1:"Artiste - Titre"`) ;
2. détecte le **tempo brut (BPM)** (même chaîne d'analyse que le backend :
   ffmpeg → `wav-decoder` → `music-tempo`) ;
3. calcule le **MPM** (mesures par minute) selon la danse choisie, avec
   correction d'octave — logique identique à
   `apps/backend/src/tracks/bpm.service.ts` ;
4. nomme les fichiers à la **convention fédération**
   `01-SAMBA ｜ Artiste - Titre (52 MPM).mp3`, écrit des tags ID3 propres
   (titre, artiste, genre = danse, `TBPM` = MPM), intègre la pochette au mp3
   et garde le `.jpg` à côté ;
5. écrit un **`manifest.json`** récapitulatif (métadonnées, BPM brut, MPM,
   `sourceKey` au format `Track.sourceKey`, lien source).

L'import par URL a été **retiré du backend** : cet outil est désormais la
seule façon d'ajouter de la musique dans FFD-Connect (l'app modifie titre /
artiste / MPM / danse, ou supprime).

## Prérequis

- Node.js ≥ 20 et pnpm ≥ 10 (comme le reste du monorepo) ;
- `pnpm install` à la racine du repo, **puis** `pnpm rebuild youtube-dl-exec`
  pour télécharger le binaire yt-dlp (téléchargement volontairement exclu de
  l'install de base : il échoue dans les environnements CI/remote au réseau
  restreint — voir `onlyBuiltDependencies` dans `pnpm-workspace.yaml`) ;
- ffmpeg : **optionnel** — s'il n'est pas installé sur le PC, le binaire
  embarqué `@ffmpeg-installer/ffmpeg` est utilisé automatiquement
  (surchargeable avec la variable d'environnement `FFMPEG_PATH`).

## Usage

Depuis la racine du repo :

```bash
# Une playlist Spotify entière, tout en Samba
pnpm track-prep --style Samba https://open.spotify.com/playlist/37i9dQ...

# Un titre Spotify + un titre YouTube, chacun sa danse
pnpm track-prep --style Tango https://open.spotify.com/track/4uLU6... \
                --style Jive  https://youtu.be/dQw4w9WgXcQ

# Une playlist YouTube sans danse précisée (le BPM brut est conservé)
pnpm track-prep https://www.youtube.com/playlist?list=PL123
```

`--style` s'applique à **tous les liens qui le suivent**, jusqu'au `--style`
suivant. Danses acceptées (et tous leurs synonymes usuels : « foxtrot »,
« waltz », « chacha »…) :

> Valse Lente, Tango, Valse Viennoise, Slow Fox, Quickstep,
> Samba, Cha-cha, Rumba, Paso Doble, Jive

### Détection automatique de la danse (playlists mélangées)

Sans `--style`, l'outil essaie de déterminer la danse de chaque titre, dans
l'ordre (désactivable avec `--no-auto-style`) :

1. **Nom de la playlist** (« Playlist SAMBA compét » → tout en Samba) ;
2. **Titre du morceau** (« Sway (Cha Cha) », « Libertango »…) ;
3. **Tempo détecté** : chaque danse a une plage BPM de compétition — quand le
   tempo ne colle qu'à une seule danse (ex. 200 BPM → Quickstep, 87 BPM →
   Valse Lente), elle est assignée automatiquement (marquée « à vérifier »).

⚠️ Le tempo seul ne peut pas toujours trancher : plusieurs danses partagent
les mêmes plages (Samba 90-115 ↔ Rumba 95-115, Cha-cha ↔ Tango 115-140,
Jive ↔ Valse Viennoise…). Dans ce cas l'outil n'assigne **rien** et liste
les danses candidates avec leur MPM respectif — dans le récapitulatif et dans
le manifeste (`styleCandidates`). Pour trancher : renseignez `style` et `mpm`
dans `manifest.json` (le MPM de chaque candidate y est déjà calculé) puis
relancez `pnpm track-prep sync --apply`. La provenance de chaque danse est
tracée dans le manifeste (`styleSource` : `option`, `playlist`, `titre` ou
`tempo`).

### Options

| Option             | Description                                                                                | Défaut              |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------- |
| `--style <danse>`  | Danse appliquée aux liens suivants (répétable)                                             | aucune              |
| `--out <dossier>`  | Dossier de sortie                                                                          | `./prepared-tracks` |
| `--limit <n>`      | Titres max par playlist                                                                    | `100`               |
| `--cookies <file>` | `cookies.txt` (format Netscape) si YouTube affiche « Sign in to confirm you're not a bot » | aucun               |

### Sortie

```
prepared-tracks/
├── 01-SAMBA ｜ Michael Bublé - Sway (52 MPM).mp3
├── 01-SAMBA ｜ Michael Bublé - Sway (52 MPM).jpg
├── 02-TANGO ｜ ... (32 MPM).mp3
└── manifest.json
```

- La numérotation continue d'une exécution à l'autre, et les titres déjà
  présents dans `manifest.json` (même `sourceKey`) sont **ignorés** — on peut
  relancer la même playlist sans doublons.
- **Dédup métier** : un titre dont (artiste + titre) normalisés (casse,
  accents, apostrophes, suffixes « (Official Video) », feat.) existent déjà
  dans le manifeste via une **autre source** (ex. le même morceau en lien
  Spotify puis YouTube) est aussi ignoré — `--allow-duplicates` pour forcer.
- Sans `--style` (et si la détection auto n'a rien donné), le fichier est
  nommé `NN-AUTRE ｜ ... (123 BPM)` : le BPM brut est conservé, à corriger
  ensuite via le manifeste ou dans l'app (PATCH admin).

## Import dans l'application

L'import par URL ayant été retiré du backend, **la sync est la voie
d'import** : `pnpm track-prep sync` (voir ci-dessous) crée les lignes
`Track` en base et envoie les fichiers vers le stockage. Les noms de
fichiers suivent malgré tout la convention fédération historique — style,
artiste, titre et tempo restent lisibles depuis le nom seul.

## Synchronisation avec la base de staging

`track-prep sync` compare le `manifest.json` local avec la table `Track` de
staging et applique les différences :

| Situation locale                                                      | Action en staging                              |
| --------------------------------------------------------------------- | ---------------------------------------------- |
| Titre du manifeste absent de la base                                  | **Création** (upload mp3 + jpg, ligne `READY`) |
| Métadonnées modifiées dans le manifeste (titre, artiste, danse, MPM…) | **Modification** des champs changés            |
| mp3 supprimé localement ou entrée retirée du manifeste                | **Suppression** (ligne + fichiers)             |

```bash
# 1. Simulation (aucune écriture) — affiche le plan
STAGING_DATABASE_URL=postgres://... pnpm track-prep sync

# 2. Application
STAGING_DATABASE_URL=postgres://... \
AZURE_STORAGE_CONNECTION_STRING=... \
pnpm track-prep sync --apply

# Staging local (docker compose) : fichiers copiés dans le uploads/ du backend
pnpm track-prep sync --apply --uploads-dir ../../apps/backend/uploads \
  --database-url postgres://postgres:postgres@localhost:5432/ffd
```

### Les modifications faites dans l'app sont protégées

L'application **ne peut pas ajouter de musique** — l'outil est la seule porte
d'entrée. En revanche, elle peut **modifier** un titre (titre, artiste, MPM,
catégorie/danse) ou le **supprimer**. La sync fait donc un **merge à trois
voies** : chaque entrée du manifeste garde un instantané `synced` (dernier
état poussé), comparé à la fois au manifeste local et à la base :

| Situation                                                 | Comportement                                                |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Champ modifié **dans l'app** seulement                    | Préservé en base et **rapatrié** dans le manifeste (`←`)    |
| Champ modifié **localement** seulement                    | Poussé en base (`~`)                                        |
| Champ modifié **des deux côtés**                          | **Conflit** signalé (`!`), rien n'est écrasé sans `--force` |
| Titre **supprimé dans l'app**                             | **Non recréé** par l'import (sans `--force`)                |
| mp3 supprimé localement mais titre **modifié dans l'app** | Suppression **bloquée** (sans `--force`)                    |

`--force` fait gagner le manifeste local sur tous ces cas.

Les champs de modération (`titleMasked`, `blacklisted`) et les
`clashTimecodes` ne sont **jamais** écrits par l'outil : ce que l'app décide
reste intact.

### Adoption des lignes préexistantes

Si un titre du manifeste correspond (même `sourceKey`) à une ligne de staging
qui n'a pas le marqueur de l'outil (ancienne ingestion par URL, reprise de
données…), la ligne est **adoptée** (`⇄`) : ses métadonnées — éditables dans
l'app — font foi et sont rapatriées dans le manifeste, ses fichiers sont
alignés sur ceux de l'outil, et elle reçoit le marqueur `jobId = "track-prep"`
pour être gérée par les syncs suivantes. Les lignes non marquées **sans**
entrée locale (ex. métronomes de test du seed) ne sont jamais touchées.

### Autres garde-fous

- **dry-run par défaut** — rien n'est écrit sans `--apply` ;
- **dédup métier** : une création dont (artiste + titre) normalisés existent
  déjà en base est signalée (`≈`) et ignorée sans `--allow-duplicates` ;
- `--no-delete` désactive les suppressions ;
- les fichiers vont vers le **blob Azure** (conteneur `tracks`, via
  `AZURE_STORAGE_CONNECTION_STRING` ou `AZURE_STORAGE_ACCOUNT_NAME`, comme
  `BlobStorageService`) et/ou le **dossier `uploads/`** du backend
  (`--uploads-dir`) pour un staging local.

Modifier un titre déjà synchronisé : éditez ses champs dans `manifest.json`
(`title`, `artist`, `style`, `mpm`…) puis relancez `sync --apply`.

## Limites connues

- Les playlists/albums Spotify sont lus via la page _embed_ publique :
  Spotify tronque cette liste (~100 titres) et les playlists **privées** ne
  sont pas accessibles — passez alors les liens des titres un par un.
- La détection de tempo analyse une fenêtre de 15 s (comme le backend) :
  vérifiez le MPM des titres à rubato ou à intro longue.
- ⚠️ **Usage personnel uniquement.** Le téléchargement passe par YouTube et
  reste soumis à ses conditions d'utilisation — c'est la raison pour laquelle
  l'import par URL a été retiré du backend. N'utilisez cet outil que pour
  préparer des musiques dont vous détenez les droits d'exploitation en
  concours/entraînement.

## Développement

```bash
pnpm --filter @ffd-connect/track-prep test        # tests unitaires (node:test)
pnpm --filter @ffd-connect/track-prep typecheck   # tsc --noEmit
```

Les tables MPM sont une copie de `apps/backend/src/tracks/bpm.service.ts`
(miroir client : `apps/client/src/features/player/utils/danceTempo.ts`) —
toute évolution doit être répercutée dans les trois fichiers.
