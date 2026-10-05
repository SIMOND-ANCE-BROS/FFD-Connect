# Module Media: Tracks + TTS

## 1) Role metier

Ce domaine couvre la bibliotheque musicale, le traitement de pistes et la synthese vocale pour les annonces/audio guidage.

## 2) Fonctionnalites

- Soumission d'URL de piste a traiter.
- Polling d'etat de job de traitement.
- Recuperation de tracks pagines.
- Download securise de tracks par token.
- Generation TTS backend et cache local client.

## 3) Endpoints backend

Base controllers:

- `apps/backend/src/tracks/tracks.controller.ts`
- `apps/backend/src/tts/tts.controller.ts`

Routes:

- `POST /tracks/process`
- `GET /tracks/jobs/:jobId`
- `GET /tracks`
- `GET /tracks/:id`
- `GET /tracks/download/:token`
- `POST /tts`

## 4) Integration client

Points client principaux:

- `apps/client/src/features/player/services/TrackService.ts`
- `apps/client/src/services/BackendService.ts`
- `apps/client/src/services/TtsService.ts`
- contexts player/performance et ecrans audio

Specificites:

- `TrackService` utilise Axios (`api`) pour catalogues/process.
- `BackendService` propose une facade metier supplementaire.
- `TtsService` telecharge et met en cache local ; la lecture cote client passe par `expo-audio`.

## 5) Regles metier

- Le processing de track est asynchrone (job status).
- Le download par token limite l'exposition directe des fichiers.
- Le TTS privilegie le cache local pour limiter latence/cout.
- Le TTS peut interrompre/reordonner la lecture courante selon implementation player.

## 6) Flux principal (ajout track URL)

1. `POST /tracks/process` avec URL.
2. Polling `GET /tracks/jobs/:jobId` jusqu'a completion.
3. Recuperation metadata via `GET /tracks/:id` et ajout bibliotheque.
4. Lecture via URL upload statique (`/uploads/...`) ou lien securise.

## 7) Risques et points d'attention

- Timeouts et retries sur traitements longs.
- Gestion de file/queue audio et concurrence avec TTS.
- Coherence des metadata (artwork, bpm, style) entre pipeline et UI.
