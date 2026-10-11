# Competition regulation tempo (#334) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In competition mode, only draw tracks whose original MPM lies in the official range of their dance, and block the start with a clear message when a selected dance has no in-range track.

**Architecture:** A dependency-free rules module (`competitionTempo.ts`) holds the MPM table and `isTempoCompliant`. `competitionProgram.ts` (which owns dance matching) gains `selectTempoCompliant` and an `offTempo` validation bucket. The controller filters the library by tempo **before** the Paso clash pool at both call sites (start + preview) and passes the clash-only pool to the validation so it can tell « no music » from « no music at the right tempo ». Playback rate stays 1.

**Tech Stack:** React Native / Expo client, TypeScript strict, Zustand, Jest (jest-expo).

**Spec:** `docs/superpowers/specs/2026-10-11-competition-presets-tempo-design.md` (Part 1, §4). Part 2 (presets, #335) is a separate plan/PR.

**Deviation from spec (deliberate):** `selectTempoCompliant` lives in `competitionProgram.ts`, not `competitionTempo.ts`, because it needs `trackMatchesDance` and `competitionProgram.ts` must import the tempo table for the validation message — keeping it in `competitionTempo.ts` would create an import cycle.

## Global Constraints

- Ranges in MPM, bounds included: Valse Lente 28-30, Tango 31-33, Valse Viennoise 58-60, Slow Fox 28-30, Quickstep 50-52, Samba 50-52, Cha-Cha-Cha 30-32, Rumba 24-26, Paso Doble 60-62, Jive 42-44.
- Keys are the canonical ids of `DANCES` (`apps/client/src/stores/performance.store.ts`).
- Compliance uses `Math.round(track.baseBpm)`; missing / `<= 0` / non-finite tempo → not compliant.
- Playback speed is never changed (`TrackPlayer.setRate(1)` stays as is).
- The library player (`features/player`) is not touched.
- User-facing copy in French; code, comments and commits in English; conventional commits.
- TypeScript strict, no `any`.
- Run commands from the worktree root `/Users/gabin/Development/FFD-Connect-tempo`.

## Review Focus

- A style matching a dance but stored with a different spelling (« Slowfox », « Cha-cha ») must be judged against the right dance's range — exercised by using library spellings in Task 2 tests.
- « 3 clashs » Paso setting where every 3-clash Paso is off-tempo but a clash-less Paso is in range: the draw must fall back to the in-range one, never play the off-tempo one — test in Task 3.
- A dance whose tracks are all excluded by the Paso clash rule (not by tempo) must keep the existing « Aucune musique disponible » message, not the tempo one — test in Task 3.
- A program with both a missing dance and an off-tempo dance must show both blocks, not only the first — test in Task 2.
- Existing fixtures with `baseBpm: 30` would silently become off-tempo and make unrelated tests fail or pass for the wrong reason — fixtures are moved to in-range tempos in Tasks 2, 3 and 4.

---

### Task 0: Worktree setup

**Files:** none

- [ ] **Step 1: Install dependencies in the worktree**

Run: `cd /Users/gabin/Development/FFD-Connect-tempo && pnpm install --frozen-lockfile`
Expected: completes without error.

- [ ] **Step 2: Baseline — the performance tests pass before any change**

Run: `pnpm --filter client exec jest src/features/performance`
Expected: all suites PASS.

---

### Task 1: Tempo rules module

**Files:**

- Create: `apps/client/src/features/performance/utils/competitionTempo.ts`
- Test: `apps/client/src/features/performance/utils/__tests__/competitionTempo.test.ts`

**Interfaces:**

- Consumes: `DANCES` from `stores/performance.store.ts` (test only); `TrackData` type.
- Produces:
  - `export interface TempoRange { min: number; max: number }`
  - `export const COMPETITION_TEMPO: Readonly<Record<string, TempoRange>>`
  - `export const tempoRange = (dance: string): TempoRange | null`
  - `export const isTempoCompliant = (track: Pick<TrackData, "baseBpm">, dance: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { DANCES } from '../../../../stores/performance.store';
import { COMPETITION_TEMPO, isTempoCompliant, tempoRange } from '../competitionTempo';

const at = (baseBpm: number) => ({ baseBpm });

describe('competition tempo rules', () => {
  it('has a range for every competition dance', () => {
    for (const dance of [...DANCES.Standard, ...DANCES.Latin]) {
      expect(tempoRange(dance)).not.toBeNull();
    }
    expect(Object.keys(COMPETITION_TEMPO)).toHaveLength(10);
  });

  it('uses the official WDSF ranges', () => {
    expect(tempoRange('Jive')).toEqual({ min: 42, max: 44 });
    expect(tempoRange('Rumba')).toEqual({ min: 24, max: 26 });
    expect(tempoRange('Valse Viennoise')).toEqual({ min: 58, max: 60 });
    expect(tempoRange('Paso Doble')).toEqual({ min: 60, max: 62 });
  });

  it('includes both bounds', () => {
    expect(isTempoCompliant(at(42), 'Jive')).toBe(true);
    expect(isTempoCompliant(at(44), 'Jive')).toBe(true);
    expect(isTempoCompliant(at(41), 'Jive')).toBe(false);
    expect(isTempoCompliant(at(45), 'Jive')).toBe(false);
  });

  it('rounds the stored MPM', () => {
    expect(isTempoCompliant(at(44.4), 'Jive')).toBe(true);
    expect(isTempoCompliant(at(44.6), 'Jive')).toBe(false);
    expect(isTempoCompliant(at(41.5), 'Jive')).toBe(true);
  });

  it('treats an unknown tempo as off-range', () => {
    expect(isTempoCompliant(at(0), 'Jive')).toBe(false);
    expect(isTempoCompliant(at(-43), 'Jive')).toBe(false);
    expect(isTempoCompliant(at(Number.NaN), 'Jive')).toBe(false);
    expect(isTempoCompliant({ baseBpm: undefined as unknown as number }, 'Jive')).toBe(false);
  });

  it('never blocks a dance without a range', () => {
    expect(tempoRange('Lindy Hop')).toBeNull();
    expect(isTempoCompliant(at(0), 'Lindy Hop')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec jest src/features/performance/utils/__tests__/competitionTempo.test.ts`
Expected: FAIL — `Cannot find module '../competitionTempo'`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Regulation tempo of the competition dances (WDSF tempos, reused by the FFD).
 * In competition mode a dance only draws tracks whose ORIGINAL tempo is in its
 * range: the playback speed is never changed. Single source of truth — fix a
 * range here and the draw and the setup message follow.
 */
import type { TrackData } from '../../player/context/PlayerContext';

/** Tempo range in MPM (mesures par minute), bounds included. */
export interface TempoRange {
  min: number;
  max: number;
}

/** Keyed by the canonical dance ids of DANCES (performance.store). */
export const COMPETITION_TEMPO: Readonly<Record<string, TempoRange>> = {
  'Valse Lente': { min: 28, max: 30 },
  Tango: { min: 31, max: 33 },
  'Valse Viennoise': { min: 58, max: 60 },
  'Slow Fox': { min: 28, max: 30 },
  Quickstep: { min: 50, max: 52 },
  Samba: { min: 50, max: 52 },
  'Cha-Cha-Cha': { min: 30, max: 32 },
  Rumba: { min: 24, max: 26 },
  'Paso Doble': { min: 60, max: 62 },
  Jive: { min: 42, max: 44 },
};

export const tempoRange = (dance: string): TempoRange | null => COMPETITION_TEMPO[dance] ?? null;

/**
 * True when the track's original MPM (`baseBpm`, already dance-aware) is in the
 * dance's range. A track without a usable tempo is off-range; a dance without
 * a range never blocks (guarded by a test: every DANCES id has one).
 */
export const isTempoCompliant = (track: Pick<TrackData, 'baseBpm'>, dance: string): boolean => {
  const range = tempoRange(dance);
  if (!range) return true;
  const mpm = track.baseBpm;
  if (typeof mpm !== 'number' || !Number.isFinite(mpm) || mpm <= 0) {
    return false;
  }
  const rounded = Math.round(mpm);
  return rounded >= range.min && rounded <= range.max;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec jest src/features/performance/utils/__tests__/competitionTempo.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/features/performance/utils/competitionTempo.ts apps/client/src/features/performance/utils/__tests__/competitionTempo.test.ts
git commit -m "feat(competition): regulation MPM range of each dance

Refs #334"
```

---

### Task 2: Tempo-aware pool and validation

**Files:**

- Modify: `apps/client/src/features/performance/utils/competitionProgram.ts` (imports at top; `ProgramValidation` / `validateProgram` / `describeValidation` around l. 273-333)
- Test: `apps/client/src/features/performance/utils/__tests__/competitionProgram.test.ts`

**Interfaces:**

- Consumes: `tempoRange`, `isTempoCompliant` (Task 1); existing `trackMatchesDance`, `normalizeRound`, `roundCategories`, `CATEGORY_LABELS`, `danceLabel`.
- Produces:
  - `export const selectTempoCompliant = (tracks: TrackData[]): TrackData[]`
  - `export interface OffTempoDance extends RoundCategoryProblem { dance: string; outOfRange: number }`
  - `ProgramValidation.offTempo: OffTempoDance[]`
  - `validateProgram(cfg, tracks, order?, allTracks?)` — `allTracks` defaults to `tracks`.

- [ ] **Step 1: Move the test fixtures to in-range tempos**

In `competitionProgram.test.ts`, import `COMPETITION_TEMPO` from `../competitionTempo` and replace the `track` helper so every fixture is compliant by default (a fixed `baseBpm: 30` would make Samba, Jive, Paso… off-tempo):

```ts
import { COMPETITION_TEMPO } from '../competitionTempo';

/** Lower bound of the range of the dance the library `style` belongs to. */
const inRangeMpm = (style: string): number => {
  const dance = Object.keys(COMPETITION_TEMPO).find((d) => trackMatchesDance(style, d));
  return dance ? COMPETITION_TEMPO[dance].min : 30;
};

const track = (id: string, style: string, baseBpm: number = inRangeMpm(style)): TrackData => ({
  id,
  title: `${style} ${id}`,
  artist: 'Artiste',
  url: `https://cdn/${id}.mp3`,
  baseBpm,
  style,
});
```

Run: `pnpm --filter client exec jest src/features/performance/utils/__tests__/competitionProgram.test.ts`
Expected: PASS (no behaviour change yet).

- [ ] **Step 2: Write the failing tests**

Add `selectTempoCompliant` to the import list from `../competitionProgram`, then append (the file already defines `cfg` and `round` helpers used by the `validateProgram` tests):

```ts
describe('selectTempoCompliant', () => {
  it('keeps in-range tracks, judged with their library spelling', () => {
    const kept = selectTempoCompliant([
      track('sf-ok', 'Slowfox', 29),
      track('cc-ok', 'Cha-cha', 31),
      track('j-ok', 'Jive', 43),
    ]);
    expect(kept.map((t) => t.id)).toEqual(['sf-ok', 'cc-ok', 'j-ok']);
  });

  it('drops off-range and tempo-less tracks', () => {
    const kept = selectTempoCompliant([
      track('j-slow', 'Jive', 38),
      track('j-fast', 'Jive', 48),
      track('r-none', 'Rumba', 0),
      track('r-ok', 'Rumba', 25),
    ]);
    expect(kept.map((t) => t.id)).toEqual(['r-ok']);
  });

  it('drops tracks matching no competition dance', () => {
    expect(selectTempoCompliant([track('x', 'Bachata', 30)])).toEqual([]);
  });
});

describe('validateProgram — regulation tempo', () => {
  const latin = (dances: string[]) => cfg([round(['Latin'], { dances: { Latin: dances } })]);

  it('reports a dance whose tracks are all off-tempo', () => {
    const all = [track('j1', 'Jive', 48), track('j2', 'Jive', 39)];
    const v = validateProgram(latin(['Jive']), selectTempoCompliant(all), undefined, all);
    expect(v.missing).toEqual([]);
    expect(v.offTempo).toEqual([
      { roundIndex: 1, category: 'Latin', dance: 'Jive', outOfRange: 2 },
    ]);
    expect(describeValidation(v)).toBe(
      'Aucune musique au tempo réglementaire pour :\n' +
        '• Tour 1 (Latines) : Jive — entre 42 et 44 MPM (2 hors tempo)',
    );
  });

  it('keeps « no music » when the dance has no track at all', () => {
    const v = validateProgram(latin(['Jive']), [], undefined, []);
    expect(v.offTempo).toEqual([]);
    expect(v.missing).toEqual([{ roundIndex: 1, category: 'Latin', dances: ['Jive'] }]);
  });

  it('shows missing and off-tempo dances together', () => {
    const all = [track('r1', 'Rumba', 30)];
    const v = validateProgram(latin(['Rumba', 'Jive']), selectTempoCompliant(all), undefined, all);
    const text = describeValidation(v);
    expect(text).toContain('Aucune musique disponible pour :\n• Tour 1 (Latines) : Jive');
    expect(text).toContain('Rumba — entre 24 et 26 MPM (1 hors tempo)');
  });

  it('defaults allTracks to the pool (no off-tempo without it)', () => {
    const v = validateProgram(latin(['Jive']), []);
    expect(v.offTempo).toEqual([]);
    expect(v.missing).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter client exec jest src/features/performance/utils/__tests__/competitionProgram.test.ts`
Expected: FAIL — `selectTempoCompliant is not a function` / `offTempo` undefined.

- [ ] **Step 4: Implement**

In `competitionProgram.ts`, add `DANCES` to the existing import from `../../../stores/performance.store`, and add next to the other local imports:

```ts
import { isTempoCompliant, tempoRange } from './competitionTempo';
```

Add after `isAmbianceTrack` (dances section):

```ts
const COMPETITION_DANCES: readonly string[] = [...DANCES.Standard, ...DANCES.Latin];

/**
 * Competition pool: tracks of a competition dance whose original tempo is in
 * that dance's regulation range (see competitionTempo). Apply BEFORE
 * selectPasoPool so its « 3 clashs » fallback only sees in-range Paso tracks.
 */
export const selectTempoCompliant = (tracks: TrackData[]): TrackData[] =>
  tracks.filter((t) =>
    COMPETITION_DANCES.some((d) => trackMatchesDance(t.style, d) && isTempoCompliant(t, d)),
  );
```

Replace the validation block (`RoundCategoryProblem` … end of `describeValidation`) with:

```ts
export interface RoundCategoryProblem {
  roundIndex: number;
  category: Category;
}

export interface MissingDances extends RoundCategoryProblem {
  dances: string[];
}

export interface OffTempoDance extends RoundCategoryProblem {
  dance: string;
  /** Tracks of the dance in the library, all outside its tempo range. */
  outOfRange: number;
}

export interface ProgramValidation {
  /** Rounds (1-based) with a group whose category has no dance selected. */
  emptyRounds: RoundCategoryProblem[];
  /** Dances for which the library has no track, grouped by round. */
  missing: MissingDances[];
  /** Dances whose tracks all miss the regulation tempo. */
  offTempo: OffTempoDance[];
}

/**
 * @param tracks the playable pool (tempo-filtered in competition).
 * @param allTracks the same library before the tempo filter — tells « no
 *   music » from « no music at the right tempo ». Defaults to `tracks`.
 */
export const validateProgram = (
  cfg: PerformanceConfig,
  tracks: TrackData[],
  order: DanceOrder = OFFICIAL_DANCE_ORDER,
  allTracks: TrackData[] = tracks,
): ProgramValidation => {
  const emptyRounds: RoundCategoryProblem[] = [];
  const missing: MissingDances[] = [];
  const offTempo: OffTempoDance[] = [];
  cfg.rounds.forEach((raw, i) => {
    const round = normalizeRound(raw, order);
    for (const category of roundCategories(round)) {
      const dances = round.dances[category];
      if (dances.length === 0) {
        emptyRounds.push({ roundIndex: i + 1, category });
        continue;
      }
      const absent: string[] = [];
      for (const d of dances) {
        if (tracks.some((t) => trackMatchesDance(t.style, d))) continue;
        const outOfRange = allTracks.filter((t) => trackMatchesDance(t.style, d)).length;
        if (outOfRange > 0) {
          offTempo.push({ roundIndex: i + 1, category, dance: d, outOfRange });
        } else {
          absent.push(d);
        }
      }
      if (absent.length > 0) {
        missing.push({ roundIndex: i + 1, category, dances: absent });
      }
    }
  });
  return { emptyRounds, missing, offTempo };
};

const describeOffTempo = (o: OffTempoDance): string => {
  const range = tempoRange(o.dance);
  const span = range ? ` — entre ${range.min} et ${range.max} MPM` : '';
  return `• Tour ${o.roundIndex} (${CATEGORY_LABELS[o.category]}) : ${danceLabel(
    o.dance,
  )}${span} (${o.outOfRange} hors tempo)`;
};

/** French, user-facing description of the validation problems (or null). */
export const describeValidation = (v: ProgramValidation): string | null => {
  if (v.emptyRounds.length > 0) {
    const list = v.emptyRounds
      .map((e) => `tour ${e.roundIndex} (${CATEGORY_LABELS[e.category]})`)
      .join(', ');
    return `Sélectionnez au moins une danse pour : ${list}.`;
  }
  const blocks: string[] = [];
  if (v.missing.length > 0) {
    const lines = v.missing.map(
      (m) =>
        `• Tour ${m.roundIndex} (${CATEGORY_LABELS[m.category]}) : ${m.dances
          .map(danceLabel)
          .join(', ')}`,
    );
    blocks.push(`Aucune musique disponible pour :\n${lines.join('\n')}`);
  }
  if (v.offTempo.length > 0) {
    blocks.push(
      `Aucune musique au tempo réglementaire pour :\n${v.offTempo
        .map(describeOffTempo)
        .join('\n')}`,
    );
  }
  return blocks.length > 0 ? blocks.join('\n\n') : null;
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter client exec jest src/features/performance/utils/__tests__/competitionProgram.test.ts`
Expected: PASS (existing + 7 new).

- [ ] **Step 6: Typecheck (other `ProgramValidation` literals must add `offTempo`)**

Run: `pnpm --filter client exec tsc --noEmit`
Expected: no error. If a file builds a `ProgramValidation` literal (grep `emptyRounds:` under `apps/client/src`), add `offTempo: []` there.

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/features/performance/utils/competitionProgram.ts apps/client/src/features/performance/utils/__tests__/competitionProgram.test.ts
git commit -m "feat(competition): tempo-compliant pool and off-tempo validation

Refs #334"
```

---

### Task 3: Wire the tempo filter into the competition engine

**Files:**

- Modify: `apps/client/src/features/performance/engine/competitionController.ts` (import list; start ~l. 592-596; `generatePlaylist` ~l. 825)
- Test: `apps/client/src/features/performance/engine/__tests__/competitionController.test.ts`

**Interfaces:**

- Consumes: `selectTempoCompliant`, `validateProgram(cfg, pool, order, allTracks)` (Task 2); existing `selectPasoPool`.
- Produces: no new API.

- [ ] **Step 1: Move the controller fixtures to in-range tempos**

In `competitionController.test.ts`, import `COMPETITION_TEMPO` from `../../utils/competitionTempo` and `trackMatchesDance` from `../../utils/competitionProgram`, and replace the `t` helper (l. ~63):

```ts
const inRangeMpm = (style: string): number => {
  const dance = Object.keys(COMPETITION_TEMPO).find((d) => trackMatchesDance(style, d));
  return dance ? COMPETITION_TEMPO[dance].min : 30;
};

const t = (id: string, style: string, baseBpm: number = inRangeMpm(style)): TrackData => ({
  id,
  title: `${style} ${id}`,
  artist: 'Artiste',
  url: `https://static/uploads/${id}.mp3`,
  baseBpm,
  style,
});
```

Run: `pnpm --filter client exec jest src/features/performance/engine`
Expected: PASS (no behaviour change yet).

- [ ] **Step 2: Write the failing tests**

Next to « lists missing dances instead of starting » (same `describe`, same setup helpers `setProgram`, `roundOf`, `deps`, `store`), add:

```ts
it('never previews an off-tempo track', () => {
  const slowJive = t('j-slow', 'Jive', 38);
  engine.setEngineDeps({ ...deps, allTracks: [slowJive, JIVE, SAMBA] });
  setProgram({
    rounds: [roundOf('Latin', 'Round', ['Samba', 'Jive'])],
  });
  engine.generatePlaylist();
  const ids = store().playlist.map((i) => i.track.id);
  expect(ids).not.toContain('j-slow');
  expect(ids).toContain(JIVE.id);
});

it('blocks the start when a dance has no in-range track', async () => {
  engine.setEngineDeps({
    ...deps,
    allTracks: [SAMBA, t('j-fast', 'Jive', 48)],
  });
  setProgram({
    rounds: [roundOf('Latin', 'Final', ['Samba', 'Jive'])],
  });
  await expect(engine.startPerformance()).resolves.toBe(false);
  expect(Alert.alert).toHaveBeenCalledWith(
    'Musiques manquantes',
    expect.stringContaining('Jive — entre 42 et 44 MPM (1 hors tempo)'),
  );
  expect(cacheTrack).not.toHaveBeenCalled();
});

it('falls back to an in-range clash-less Paso with « 3 clashs »', () => {
  const offTempoThree = {
    ...t('p3', 'Paso Doble', 66),
    clashTimecodes: [30, 60, 90],
  };
  const inRangeNoClash = t('p0', 'Paso Doble', 61);
  engine.setEngineDeps({
    ...deps,
    allTracks: [offTempoThree, inRangeNoClash],
  });
  setProgram({
    pasoClashes: 3,
    rounds: [roundOf('Latin', 'Final', ['Paso Doble'])],
  });
  engine.generatePlaylist();
  expect(store().playlist.map((i) => i.track.id)).toEqual(['p0']);
});

it('keeps « no music » when Pasos are excluded by the clash rule only', async () => {
  const twoClashes = {
    ...t('p2', 'Paso Doble', 61),
    clashTimecodes: [30, 60],
  };
  engine.setEngineDeps({ ...deps, allTracks: [twoClashes] });
  setProgram({
    pasoClashes: 3,
    rounds: [roundOf('Latin', 'Final', ['Paso Doble'])],
  });
  await expect(engine.startPerformance()).resolves.toBe(false);
  const message = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[1];
  expect(message).toContain('Aucune musique disponible');
  expect(message).not.toContain('tempo réglementaire');
});
```

Note: `startPerformance` loads the library through `loadCompetitionLibrary(deps.trackRepo, deps.allTracks)`; with `trackRepo: null` it returns `deps.allTracks` — the existing « lists missing dances » test relies on that, so do these. If the file names the start function differently, use the one the existing « lists missing dances » test calls.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter client exec jest src/features/performance/engine`
Expected: the first 3 new tests FAIL (off-tempo tracks still drawn, no tempo message); the 4th may already pass — it pins behaviour.

- [ ] **Step 4: Implement**

Add `selectTempoCompliant` to the existing import from `../utils/competitionProgram` in `competitionController.ts`.

At start (replace the `const pool = …` and `const validation = …` lines after `const order = …`):

```ts
// Regulation tempo: only in-range tracks are drawn — filtered BEFORE the
// Paso clash rule so its « 3 clashs » fallback never picks an off-tempo
// Paso. `clashPool` (same rule, no tempo filter) lets the validation tell
// « no music » from « no music at the right tempo ».
const clashPool = selectPasoPool(library.tracks, cfg.pasoClashes);
const pool = selectPasoPool(selectTempoCompliant(library.tracks), cfg.pasoClashes);
const validation = validateProgram(cfg, pool, order, clashPool);
```

In `generatePlaylist`:

```ts
const pool = selectPasoPool(selectTempoCompliant(d.allTracks), s.config.pasoClashes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter client exec jest src/features/performance`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/features/performance/engine/competitionController.ts apps/client/src/features/performance/engine/__tests__/competitionController.test.ts
git commit -m "feat(competition): draw only regulation-tempo tracks

Refs #334"
```

---

### Task 4: Full client checks

**Files:** none (fix-ups only if a check fails)

- [ ] **Step 1: Typecheck, lint, format, client tests**

Run:

```bash
pnpm typecheck
pnpm --filter client lint
pnpm format:check
pnpm --filter client test
```

Expected: all green. Other suites that build competition fixtures with `baseBpm: 30` (e.g. `PerformanceSetupScreen.test.tsx`, `PerformancePlayerScreen.test.tsx`, `PerformanceContext.test.tsx`) may now hit the tempo filter: move their fixtures to in-range tempos the same way (`inRangeMpm`), never loosen the filter.

- [ ] **Step 2: Commit fix-ups if any**

```bash
git add apps/client/src
git commit -m "test(competition): in-range tempos in competition fixtures

Refs #334"
```

---

### Task 5: Rollout check on the staging library (spec §4.6)

**Files:** none — report only.

- [ ] **Step 1: Count compliant tracks per dance on staging**

`GET /tracks` requires a JWT: ask Gabin for a staging account (never store or commit the token). One paginated read wakes `backend-staging` once — acceptable, no polling.

```bash
API=https://api-staging.ffd.gabin-simond.fr/api/v1
TOKEN=...   # from POST $API/auth/login
for skip in 0 100 200 300 400 500; do
  curl -s -H "Authorization: Bearer $TOKEN" "$API/tracks?skip=$skip&take=100"
done | jq -s '[.[] | (.data // .)[]] | map({style, bpm: (.baseBpm // .bpm)})' > /tmp/staging-tracks.json
```

Then count per dance with a throwaway Node script in `/tmp` (copy the 10 ranges and the `DANCE_INFO` regexes; import nothing from the repo): tracks per dance, tracks in range, off-range MPM values.

- [ ] **Step 2: Report**

Put the table (dance / total / in range) in the PR description and flag every dance with 0 in-range track: it becomes blocked for testers. Gabin decides whether to ship as is or to fix/import tracks first.

---

### Task 6: PR

- [ ] **Step 1: Push and open the PR on `develop`** (only once Gabin agreed to push)

Title: `feat(competition): only draw tracks at the regulation tempo of each dance`
Body follows `.github/pull_request_template.md`: `Refs #334`; summary; « Pour les testeurs » in French:

```
- Mode compétition : chaque danse ne joue plus que des musiques au tempo réglementaire (ex. Jive entre 42 et 44 MPM). Si une danse n'a aucune musique au bon tempo, le lancement est bloqué et le message indique la plage attendue. À vérifier : lancer une compétition Latines et contrôler que le tempo affiché de chaque musique est dans la plage.
```

Test plan: the 4 test files above + the staging count of Task 5. Never merge without Gabin's explicit go.
