# Competition mode — regulation tempo & program presets — design

- **Date:** 2026-10-11
- **Status:** draft, pending review
- **Builds on:** competition mode rebuild (PRs #133 and #176 — rounds = groups)
- **Issues:** #334 (regulation tempo), #335 (program presets)
- **Delivery:** two independent PRs on `develop`, tempo first

## 1. Goal

1. **Regulation tempo.** In competition mode, every dance is played with a track whose original tempo lies in the official MPM range of that dance — a Jive is never too slow or too fast, a Rumba neither.
2. **Presets.** A user saves the program they configured (rounds, groups, dances, durations, Paso clashes) under a name, and reloads it in one tap instead of rebuilding it every session.

Success: a competition can only start when every selected dance has at least one in-range track, and the program of the last training is one tap away.

## 2. Decisions (taken with the user)

| Topic                 | Decision                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Out-of-range track    | **Excluded** from the draw. Playback speed is never changed (rate stays 1, as today).                                                        |
| No in-range track     | **Start blocked**, same treatment as today's « Aucune musique disponible », with a dedicated message naming the range.                       |
| Ranges                | WDSF tempos (reused by the FFD), bounds included, in a single table so they can be corrected. See §4.1.                                      |
| Track without tempo   | Treated as out of range.                                                                                                                     |
| Free player (library) | Unchanged: ±50 % slider, per-style lock, no regulation constraint.                                                                           |
| Preset content        | The whole `PerformanceConfig` (rounds, duration, pause, Paso clashes). The dance order stays a separate global setting (`danceOrder.store`). |
| Preset storage        | On the device only (AsyncStorage). No multi-device sync, no club sharing, no built-in official presets.                                      |

## 3. Existing behaviour kept

- `stores/performance.store.ts`: `PerformanceConfig` and the competition runtime state, **not persisted** (it ticks every second during a competition).
- `stores/danceOrder.store.ts`: persisted dance order — the model the presets store follows.
- `features/performance/utils/competitionProgram.ts`: `trackMatchesDance`, `normalizeRound`, `buildPlaylist` (per-dance shuffled pools rotating across rounds), `validateProgram` / `describeValidation`.
- `features/performance/utils/pasoClashCap.ts`: `selectPasoPool` (with « 3 clashs », only Paso tracks with 3 saved clashes, falling back to tracks without saved clashes).
- `features/performance/engine/competitionController.ts`: `playOnMain` forces `TrackPlayer.setRate(1)`; start (l. ~594) and `generatePlaylist` (l. ~825) build the pool with `selectPasoPool` then validate / build.
- `TrackData.baseBpm` already holds the dance-aware **MPM** computed by the backend (`BpmService.calculateMpm`).

## 4. Part 1 — Regulation tempo

### 4.1 Rules table

New `features/performance/utils/competitionTempo.ts`:

```ts
/** Official tempo range of each competition dance, in MPM, bounds included. */
export const COMPETITION_TEMPO: Record<string, { min: number; max: number }> = {
  "Valse Lente": { min: 28, max: 30 },
  Tango: { min: 31, max: 33 },
  "Valse Viennoise": { min: 58, max: 60 },
  "Slow Fox": { min: 28, max: 30 },
  Quickstep: { min: 50, max: 52 },
  Samba: { min: 50, max: 52 },
  "Cha-Cha-Cha": { min: 30, max: 32 },
  Rumba: { min: 24, max: 26 },
  "Paso Doble": { min: 60, max: 62 },
  Jive: { min: 42, max: 44 },
};

export const tempoRange = (dance: string) => COMPETITION_TEMPO[dance] ?? null;

/** True when the track's original MPM is inside the dance's range. */
export const isTempoCompliant = (track: TrackData, dance: string): boolean;

/** Competition pool: dance tracks matching a competition dance AND in range. */
export const selectTempoCompliant = (tracks: TrackData[]): TrackData[];
```

- Keys are the canonical dance ids of `DANCES` (`performance.store.ts`). A unit test pins that every id of `DANCES` has a range.
- `isTempoCompliant`: `baseBpm` missing, `<= 0` or non-finite → `false`. Otherwise `Math.round(baseBpm)` compared to `[min, max]` inclusive (MPM are stored rounded; rounding makes 43.6 → 44 compliant and avoids float noise).
- A dance without a range (should not happen, guarded by the test) → compliant, so an unexpected dance id never blocks a competition.
- `selectTempoCompliant` keeps a track when, for the canonical dance it matches (`trackMatchesDance`), `isTempoCompliant` holds.

### 4.2 Pool

In `competitionController.ts`, both call sites become:

```ts
const pool = selectPasoPool(selectTempoCompliant(tracks), cfg.pasoClashes);
```

Tempo filtering happens **before** `selectPasoPool`, so its « 3 clashs » fallback only ever considers in-range Paso tracks. `buildPlaylist` itself is unchanged (it already draws only from the pool it receives).

### 4.3 Validation

`validateProgram(cfg, pool, order, allTracks?)` gains an optional 4th argument: the unfiltered library. For a dance with no track in `pool`:

- no track of that dance in `allTracks` either → existing `missing` entry (« Aucune musique disponible pour : … »);
- otherwise → new `offTempo` entry `{ roundIndex, category, dance, outOfRange: number }`.

`ProgramValidation` gets `offTempo: OffTempoDance[]`. `describeValidation` adds, after `missing`:

```
Aucune musique au tempo réglementaire pour :
• Tour 1 (Latines) : Jive — entre 42 et 44 MPM (3 hors tempo)
```

The start is blocked exactly like today (`describeValidation` non-null). The start call site passes `library.tracks` as `allTracks`.

### 4.4 Out of scope

- No playback-rate correction, no « nearest track » fallback.
- No change to the library player, to the backend MPM computation, or to how tempo is displayed.

### 4.5 Tests

- `competitionTempo.test.ts`: every `DANCES` id has a range; bounds included (Jive 42 and 44 in, 41 and 45 out); rounding (43.6 in, 44.6 out); missing / zero / NaN tempo out; `selectTempoCompliant` drops off-range and keeps in-range tracks across categories.
- `competitionProgram.test.ts`: `validateProgram` returns `offTempo` (not `missing`) when the dance exists only off-range; `describeValidation` message.
- `competitionController.test.ts`: the generated playlist never contains an off-range track; start is blocked with the off-tempo message.
- `pasoClashCap` interaction: with « 3 clashs », an off-range 3-clash Paso is never drawn.

### 4.6 Rollout check

Before opening the PR, count compliant tracks per dance on the staging library and report it: dances with zero compliant track would become blocked for testers.

## 5. Part 2 — Program presets

### 5.1 Store

New `stores/competitionPresets.store.ts` (Zustand + `persist`, AsyncStorage, key `competition-presets`, version 1), modelled on `danceOrder.store.ts`:

```ts
export interface CompetitionPreset {
  id: string;
  name: string;
  updatedAt: string; // ISO 8601
  config: PerformanceConfig;
}

interface CompetitionPresetsState {
  presets: CompetitionPreset[]; // most recently updated first
  /** Preset the current program was loaded from / saved as (null = custom). */
  activePresetId: string | null;
  save: (name: string, config: PerformanceConfig) => SaveResult;
  overwrite: (id: string, config: PerformanceConfig) => void;
  rename: (id: string, name: string) => SaveResult;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
}
type SaveResult = { ok: true; id: string } | { ok: false; reason: 'empty' | 'duplicate' | 'full' };
```

- `MAX_PRESETS = 20`; name trimmed, 1–40 chars; duplicate check is case-insensitive.
- `save` with an existing name returns `duplicate`: the UI then offers to overwrite that preset.
- Stored configs are deep copies (no shared reference with the live config).
- `merge` sanitizes persisted data: drops entries without id / name / rounds array, truncates to `MAX_PRESETS`, resets `activePresetId` when it no longer exists.

### 5.2 Loading a preset

New pure helper in `competitionProgram.ts`:

```ts
export const configFromPreset = (saved: unknown): PerformanceConfig;
```

- Starts from `createDefaultConfig()` and takes each field only if valid: `duration` / `pauseDuration` positive finite numbers, `pasoClashes` 2 or 3, `rounds` a non-empty array.
- Each round: `type` `Round`/`Final` (else `Round`), `groups` filtered to known categories and clamped to `MIN..MAX_ROUND_GROUPS`, dances filtered to `DANCES` (via `normalizeRound`), **fresh id** (`createRoundId`). Invalid rounds dropped; no valid round left → default round.
- Loading = `setConfig(configFromPreset(preset.config))` + `setActive(preset.id)`.

### 5.3 « Modified » indicator

`isSameProgram(a, b)` compares two configs ignoring round ids (rounds compared by type, groups, dances; then duration, pause, clashes). The banner shows « modifié » when `activePresetId` is set and the live config differs from that preset.

### 5.4 Setup screen

`PerformanceSetupScreen`:

- **Banner** at the top: « Preset : _<name>_ » (+ « modifié » + « Mettre à jour » button) or « Programme personnalisé », and a **Presets** button.
- **Presets sheet** (new `features/performance/components/PresetsSheet.tsx`): saved presets (name + date), each with Charger / Renommer / Supprimer (delete asks for confirmation); « Enregistrer le programme actuel » opens a name field. Error states: empty name, duplicate (→ « Remplacer ? »), list full (20).
- Disabled while a competition is running (status not `idle` / `finished`), like the rest of the configuration.
- All copy in French, accessibility labels on every button.

### 5.5 Out of scope

Sync across devices, club sharing, official built-in presets, export/import, dance order inside presets.

### 5.6 Tests

- `competitionPresets.store.test.ts`: save / duplicate / full / empty name / rename / overwrite / remove (clears `activePresetId`), corrupted persisted payload.
- `competitionProgram.test.ts`: `configFromPreset` (valid, partial, garbage, unknown dances, group bounds, fresh ids); `isSameProgram`.
- `PresetsSheet.test.tsx` + `PerformanceSetupScreen.test.tsx`: save then load restores the program; « modifié » after an edit; « Mettre à jour » overwrites; controls disabled during a competition.

## 6. Risks

- **Library coverage (Part 1):** the stricter draw may block dances that played before. Mitigated by the §4.6 count before release and an explicit message telling which range is missing.
- **Ranges validity:** WDSF values assumed to apply to FFD competitions; a single table makes a correction a one-line change.
- **Stored data drift (Part 2):** a future `PerformanceConfig` change must keep `configFromPreset` tolerant; covered by the garbage-input tests.
