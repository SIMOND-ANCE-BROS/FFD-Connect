# Competition program presets (#335) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save the competition program they configured (rounds, groups, dances, durations, Paso clashes, MC voice) under a name on the device, and reload it in one tap from the competition setup screen.

**Architecture:** A persisted Zustand store (`stores/competitionPresets.store.ts`, AsyncStorage, modelled on `danceOrder.store.ts`) owns the preset list and the name rules. `competitionProgram.ts` gains two pure helpers: `configFromPreset` (tolerant rebuild of a stored config, fresh round ids) and `isSameProgram` (comparison ignoring round ids, for the « modifié » flag). The UI is a presentational `PresetsSheet` (bottom-sheet `Modal`, same pattern as `components/FilterSheet.tsx`) plus a small `PresetBanner`, both wired in `PerformanceSetupScreen`. The live `PerformanceConfig` stays in the non-persisted `performance.store` — untouched.

**Tech Stack:** React Native / Expo client, TypeScript strict, Zustand 5 + `persist`, `@react-native-async-storage/async-storage`, Jest (jest-expo) + React Native Testing Library 14 (async `render` / `fireEvent`).

**Spec:** `docs/superpowers/specs/2026-10-11-competition-presets-tempo-design.md` (Part 2, §5; §2 decisions and §3 existing behaviour apply). Part 1 (regulation tempo, #334) is a separate plan/PR.

**Deviations from spec (deliberate):**

1. **`activePresetId` is not persisted** (`partialize` keeps only `presets`). The live program is not persisted and resets to the default at launch: a persisted `activePresetId` would show « Preset : X — modifié » over a default program after every restart. `merge` still resets an `activePresetId` that no longer exists, as the spec asks.
2. **`announcements` is part of the preset** (taken by `configFromPreset`, compared by `isSameProgram`). The spec lists duration / pause / clashes, but `PerformanceConfig` gained `announcements` and §2 says the preset is « the whole `PerformanceConfig` ».
3. **Names longer than 40 characters are truncated** (and the `TextInput` has `maxLength={40}`) rather than refused: `SaveResult` has no « too long » reason.
4. **Locking during a competition** applies to the preset controls only. The spec says « like the rest of the configuration », but the setup screen today does not lock its other controls; locking them is out of scope.

## Global Constraints

- Store: Zustand + `persist`, AsyncStorage, key `competition-presets`, version 1. No new React Context.
- `MAX_PRESETS = 20`; name trimmed, 1–40 chars; duplicate check is case-insensitive.
- `save` with an existing name returns `duplicate`: the UI offers to overwrite that preset (« Remplacer ? »).
- Stored configs are deep copies (no shared reference with the live config).
- `merge` sanitizes persisted data: drops entries without id / name / rounds array, truncates to `MAX_PRESETS`, resets `activePresetId` when it no longer exists.
- `configFromPreset` starts from `createDefaultConfig()`; `duration` / `pauseDuration` positive finite numbers, `pasoClashes` 2 or 3, `rounds` a non-empty array; groups filtered to known categories and clamped to `MIN..MAX_ROUND_GROUPS`; dances filtered to `DANCES` (via `normalizeRound`); fresh round id (`createRoundId`); invalid rounds dropped; no valid round left → default round.
- Loading = `setConfig(configFromPreset(preset.config))` + `setActive(preset.id)`.
- The dance order stays a separate global setting (`danceOrder.store`) — never inside a preset.
- Out of scope: sync across devices, club sharing, official built-in presets, export/import.
- User copy in French; code, comments and commits in English; conventional commits with `Refs #335`; accessibility label + hint on every button.
- TypeScript strict, no `any`.
- Run commands from the worktree root `/Users/gabin/Development/FFD-Connect-presets`.
- A git hook rejects any command that combines `git commit` with a `-n` flag or the word « no-verify » (even inside `grep -n`): run `git commit` as its own command.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Saving under an existing name when the list is already full (20):** the user expects « Remplacer ? », not « liste pleine » — `duplicate` is checked before `full`. Test in Task 1.
- **App restart:** the live program is back to the default; the banner must say « Programme personnalisé », not « Preset : X — modifié ». Test in Task 1 (rehydrate → `activePresetId` null, not persisted).
- **Editing the live program after saving or loading** must never alter the stored preset (shared arrays between live config and preset). Tests in Task 1 (save copies) and Task 2 (load copies).
- **Names differing only by case or spaces** (« Gala » / « gala ») are the same preset; renaming a preset to its own name with another case is allowed. Test in Task 1.
- **Right after loading a preset** (fresh round ids), the banner must not say « modifié ». Test in Task 4.

---

### Task 0: Worktree setup

**Files:** none

- [ ] **Step 1: Install dependencies in the worktree**

Run: `cd /Users/gabin/Development/FFD-Connect-presets && pnpm install --frozen-lockfile`
Expected: completes without error.

- [ ] **Step 2: Baseline — the suites this plan touches pass before any change**

Run: `pnpm --filter client exec jest src/stores src/features/performance`
Expected: all suites PASS.

---

### Task 1: Presets store

**Files:**

- Create: `apps/client/src/stores/competitionPresets.store.ts`
- Test: `apps/client/src/stores/__tests__/competitionPresets.store.test.ts`

**Interfaces:**

- Consumes: `type PerformanceConfig` from `apps/client/src/stores/performance.store.ts`; `createDefaultConfig` (test only).
- Produces:
  - `export const MAX_PRESETS = 20`
  - `export const PRESET_NAME_MAX_LENGTH = 40`
  - `export const COMPETITION_PRESETS_STORAGE_KEY = "competition-presets"`
  - `export interface CompetitionPreset { id: string; name: string; updatedAt: string; config: PerformanceConfig }`
  - `export type SaveResult = { ok: true; id: string } | { ok: false; reason: "empty" | "duplicate" | "full" }`
  - `export const cleanPresetName = (name: string): string`
  - `export const findPresetByName = (presets: readonly CompetitionPreset[], name: string): CompetitionPreset | undefined`
  - `export const resolvePresets = (saved: unknown): CompetitionPreset[]`
  - `export const useCompetitionPresetsStore` with state `{ presets: CompetitionPreset[]; activePresetId: string | null }` and actions `save(name, config): SaveResult`, `overwrite(id, config): void`, `rename(id, name): SaveResult`, `remove(id): void`, `setActive(id: string | null): void`.
  - Behaviour later tasks rely on: `save` and `overwrite` make the preset active and put it first; `remove` clears `activePresetId` when it was the removed one; `rename` keeps position and `updatedAt`.

- [ ] **Step 1: Write the failing test**

AsyncStorage is mocked globally by `apps/client/jest.setup.js` (an in-memory `Map` behind `jest.fn()` wrappers), so the test reads and writes the real persisted entry, like `danceOrder.store.test.ts`.

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  COMPETITION_PRESETS_STORAGE_KEY,
  MAX_PRESETS,
  PRESET_NAME_MAX_LENGTH,
  findPresetByName,
  resolvePresets,
  useCompetitionPresetsStore,
  type SaveResult,
} from '../competitionPresets.store';
import { createDefaultConfig, type PerformanceConfig } from '../performance.store';

const store = () => useCompetitionPresetsStore.getState();

const config = (duration = 90): PerformanceConfig => ({
  ...createDefaultConfig(),
  duration,
});

/** Id of a successful save (fails the test otherwise). */
const idOf = (result: SaveResult): string => {
  if (!result.ok) throw new Error(`save failed: ${result.reason}`);
  return result.id;
};

/** Last value written to the device storage, parsed. */
const saved = async () => {
  const raw = await AsyncStorage.getItem(COMPETITION_PRESETS_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { state: unknown; version: number }) : null;
};

const writeStorage = (state: unknown) =>
  AsyncStorage.setItem(COMPETITION_PRESETS_STORAGE_KEY, JSON.stringify({ state, version: 1 }));

describe('competitionPresets.store', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useCompetitionPresetsStore.setState({ presets: [], activePresetId: null });
  });

  it('saves the programme under a trimmed name, newest first, and makes it active', () => {
    const a = store().save('  Gala  ', config(60));
    const b = store().save('Entraînement', config(90));
    expect(a).toEqual({ ok: true, id: expect.any(String) });
    expect(store().presets.map((p) => p.name)).toEqual(['Entraînement', 'Gala']);
    expect(store().presets[1].config.duration).toBe(60);
    expect(store().activePresetId).toBe(idOf(b));
    expect(Number.isNaN(Date.parse(store().presets[0].updatedAt))).toBe(false);
  });

  it('refuses an empty name', () => {
    expect(store().save('   ', config())).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(store().presets).toHaveLength(0);
  });

  it('caps the name length', () => {
    store().save('x'.repeat(PRESET_NAME_MAX_LENGTH + 10), config());
    expect(store().presets[0].name).toHaveLength(PRESET_NAME_MAX_LENGTH);
  });

  it('reports a duplicate name, case- and space-insensitively', () => {
    store().save('Gala', config());
    expect(store().save(' gala  ', config(30))).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    expect(findPresetByName(store().presets, 'GALA')?.config.duration).toBe(90);
    expect(store().presets).toHaveLength(1);
  });

  it('refuses a new name when full, but still reports a duplicate first', () => {
    for (let i = 0; i < MAX_PRESETS; i++) store().save(`P${i}`, config());
    expect(store().save('Nouveau', config())).toEqual({
      ok: false,
      reason: 'full',
    });
    expect(store().save('p3', config())).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    expect(store().presets).toHaveLength(MAX_PRESETS);
  });

  it('stores a deep copy of the programme', () => {
    const live = config();
    store().save('Gala', live);
    live.rounds[0].groups.push('Standard');
    live.rounds[0].dances.Latin.pop();
    live.duration = 10;
    const stored = store().presets[0].config;
    expect(stored.rounds[0].groups).toEqual(['Latin', 'Latin']);
    expect(stored.rounds[0].dances.Latin).toHaveLength(5);
    expect(stored.duration).toBe(90);
  });

  it("overwrites a preset's programme, moves it first and makes it active", () => {
    const gala = idOf(store().save('Gala', config(60)));
    store().save('Autre', config());
    store().setActive(null);

    const live = config(45);
    store().overwrite(gala, live);
    live.rounds[0].groups.pop();

    expect(store().presets[0]).toMatchObject({ id: gala, name: 'Gala' });
    expect(store().presets[0].config.duration).toBe(45);
    expect(store().presets[0].config.rounds[0].groups).toHaveLength(2);
    expect(store().activePresetId).toBe(gala);
    expect(store().presets).toHaveLength(2);
  });

  it('ignores an overwrite of an unknown preset', () => {
    store().save('Gala', config(60));
    store().overwrite('nope', config(45));
    expect(store().presets).toHaveLength(1);
    expect(store().presets[0].config.duration).toBe(60);
  });

  it("renames a preset, refusing an empty name or another preset's name", () => {
    store().save('Autre', config());
    const gala = idOf(store().save('Gala', config()));
    const before = store().presets.map((p) => p.id);

    expect(store().rename(gala, '  ')).toEqual({ ok: false, reason: 'empty' });
    expect(store().rename(gala, 'autre')).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    // Its own name with another case is not a duplicate.
    expect(store().rename(gala, 'GALA')).toEqual({ ok: true, id: gala });
    expect(store().rename(gala, '  Championnat ')).toEqual({
      ok: true,
      id: gala,
    });
    expect(findPresetByName(store().presets, 'championnat')?.id).toBe(gala);
    // Renaming does not reorder the list.
    expect(store().presets.map((p) => p.id)).toEqual(before);
  });

  it('removes a preset and clears it when it was the active one', () => {
    const a = idOf(store().save('A', config()));
    const b = idOf(store().save('B', config()));
    store().remove(a);
    expect(store().activePresetId).toBe(b);
    store().remove(b);
    expect(store().activePresetId).toBeNull();
    expect(store().presets).toEqual([]);
  });

  it('only activates a preset that exists', () => {
    const a = idOf(store().save('A', config()));
    store().setActive('nope');
    expect(store().activePresetId).toBeNull();
    store().setActive(a);
    expect(store().activePresetId).toBe(a);
  });

  it('persists only the presets on the device', async () => {
    store().save('Gala', config());
    await Promise.resolve();
    const entry = await saved();
    expect(entry?.version).toBe(1);
    expect(entry?.state).toEqual({ presets: store().presets });
  });

  it('restores the presets of the previous session, with no active one', async () => {
    const stored = config(60);
    const preset = {
      id: 'p1',
      name: 'Gala',
      updatedAt: '2026-10-11T10:00:00.000Z',
      config: stored,
    };
    await writeStorage({ presets: [preset], activePresetId: 'p1' });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().presets).toEqual([preset]);
    expect(store().activePresetId).toBeNull();
  });

  it("keeps the session's active preset only if it still exists after rehydration", async () => {
    const stored = config();
    await writeStorage({
      presets: [{ id: 'p1', name: 'A', updatedAt: '', config: stored }],
    });
    useCompetitionPresetsStore.setState({ activePresetId: 'p1' });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().activePresetId).toBe('p1');

    await writeStorage({ presets: [] });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().activePresetId).toBeNull();
  });

  it('drops corrupted entries from storage', async () => {
    const valid = config();
    await writeStorage({
      presets: [
        null,
        'x',
        { id: '', name: 'A', config: valid },
        { id: 'p1', name: '   ', config: valid },
        { id: 'p2', name: 'B', config: { rounds: 'no' } },
        { id: 'p3', name: ' C ', updatedAt: 'garbage', config: valid },
        { id: 'p3', name: 'D', config: valid },
      ],
    });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().presets).toEqual([
      {
        id: 'p3',
        name: 'C',
        updatedAt: new Date(0).toISOString(),
        config: valid,
      },
    ]);
  });

  it('falls back to an empty list on unusable storage', async () => {
    await writeStorage({ presets: 'oops' });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().presets).toEqual([]);
    await writeStorage('oops');
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().presets).toEqual([]);
  });
});

describe('resolvePresets', () => {
  it('keeps at most MAX_PRESETS entries, in stored order', () => {
    const valid = config();
    const many = Array.from({ length: MAX_PRESETS + 5 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      updatedAt: '2026-10-11T10:00:00.000Z',
      config: valid,
    }));
    const kept = resolvePresets(many);
    expect(kept).toHaveLength(MAX_PRESETS);
    expect(kept[0].id).toBe('p0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec jest src/stores/__tests__/competitionPresets.store.test.ts`
Expected: FAIL — `Cannot find module '../competitionPresets.store'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PerformanceConfig } from './performance.store';

/** Most presets a device keeps. */
export const MAX_PRESETS = 20;
/** Longest preset name, in characters (longer names are truncated). */
export const PRESET_NAME_MAX_LENGTH = 40;
export const COMPETITION_PRESETS_STORAGE_KEY = 'competition-presets';

/** A competition programme saved under a name, on this device only. */
export interface CompetitionPreset {
  id: string;
  name: string;
  /** ISO 8601 — last time the programme of the preset was saved. */
  updatedAt: string;
  /**
   * Programme as saved. Always load it through `configFromPreset`
   * (competitionProgram.ts): stored data may predate the current shape.
   */
  config: PerformanceConfig;
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'empty' | 'duplicate' | 'full' };

/** Trimmed name capped at PRESET_NAME_MAX_LENGTH ("" when nothing usable). */
export const cleanPresetName = (name: string): string =>
  name.trim().slice(0, PRESET_NAME_MAX_LENGTH).trim();

/** Preset with that name, compared trimmed and case-insensitively. */
export const findPresetByName = (
  presets: readonly CompetitionPreset[],
  name: string,
): CompetitionPreset | undefined => {
  const wanted = cleanPresetName(name).toLowerCase();
  return presets.find((p) => p.name.toLowerCase() === wanted);
};

/** Deep copy: a stored preset never shares a reference with the live config. */
const copyConfig = (config: PerformanceConfig): PerformanceConfig =>
  JSON.parse(JSON.stringify(config)) as PerformanceConfig;

let presetSeq = 0;
const createPresetId = (): string => {
  presetSeq += 1;
  return `preset-${Date.now().toString(36)}-${presetSeq}`;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Sanitizes a (possibly stale or corrupted) persisted list: drops entries
 * without an id, a name or a rounds array, and duplicated ids; caps the list
 * at MAX_PRESETS. The configs are only checked shallowly here —
 * `configFromPreset` rebuilds them field by field when a preset is loaded.
 */
export const resolvePresets = (saved: unknown): CompetitionPreset[] => {
  if (!Array.isArray(saved)) return [];
  const kept: CompetitionPreset[] = [];
  for (const entry of saved) {
    if (kept.length >= MAX_PRESETS) break;
    if (!isRecord(entry)) continue;
    const { id, name, updatedAt, config } = entry;
    if (typeof id !== 'string' || id === '') continue;
    if (kept.some((p) => p.id === id)) continue;
    if (typeof name !== 'string' || cleanPresetName(name) === '') continue;
    if (!isRecord(config) || !Array.isArray(config.rounds)) continue;
    kept.push({
      id,
      name: cleanPresetName(name),
      updatedAt:
        typeof updatedAt === 'string' && !Number.isNaN(Date.parse(updatedAt))
          ? updatedAt
          : new Date(0).toISOString(),
      config: config as unknown as PerformanceConfig,
    });
  }
  return kept;
};

interface CompetitionPresetsState {
  /** Most recently saved first. */
  presets: CompetitionPreset[];
  /**
   * Preset the live programme was loaded from / saved as (null = custom
   * programme). Session only: see `partialize`.
   */
  activePresetId: string | null;
  /** Saves the programme under a new name and makes it the active preset. */
  save: (name: string, config: PerformanceConfig) => SaveResult;
  /** Replaces the programme of a preset, moves it first, makes it active. */
  overwrite: (id: string, config: PerformanceConfig) => void;
  /** Renames a preset (position and date kept). Unknown id: no-op. */
  rename: (id: string, name: string) => SaveResult;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
}

/**
 * Competition programmes saved by the user, persisted on the device. Kept out
 * of the performance store on purpose — that one ticks every second during a
 * competition and persisting it would write to storage on every tick.
 */
export const useCompetitionPresetsStore = create<CompetitionPresetsState>()(
  persist(
    (set, get) => ({
      presets: [],
      activePresetId: null,
      save: (name, config) => {
        const clean = cleanPresetName(name);
        if (clean === '') return { ok: false, reason: 'empty' };
        const { presets } = get();
        // Duplicate before full: the UI then offers to replace that preset.
        if (findPresetByName(presets, clean)) {
          return { ok: false, reason: 'duplicate' };
        }
        if (presets.length >= MAX_PRESETS) return { ok: false, reason: 'full' };
        const preset: CompetitionPreset = {
          id: createPresetId(),
          name: clean,
          updatedAt: new Date().toISOString(),
          config: copyConfig(config),
        };
        set({ presets: [preset, ...presets], activePresetId: preset.id });
        return { ok: true, id: preset.id };
      },
      overwrite: (id, config) => {
        const target = get().presets.find((p) => p.id === id);
        if (!target) return;
        const updated: CompetitionPreset = {
          ...target,
          updatedAt: new Date().toISOString(),
          config: copyConfig(config),
        };
        set((s) => ({
          presets: [updated, ...s.presets.filter((p) => p.id !== id)],
          activePresetId: id,
        }));
      },
      rename: (id, name) => {
        const clean = cleanPresetName(name);
        if (clean === '') return { ok: false, reason: 'empty' };
        const other = findPresetByName(get().presets, clean);
        if (other && other.id !== id) {
          return { ok: false, reason: 'duplicate' };
        }
        set((s) => ({
          presets: s.presets.map((p) => (p.id === id ? { ...p, name: clean } : p)),
        }));
        return { ok: true, id };
      },
      remove: (id) =>
        set((s) => ({
          presets: s.presets.filter((p) => p.id !== id),
          activePresetId: s.activePresetId === id ? null : s.activePresetId,
        })),
      setActive: (id) =>
        set((s) => ({
          activePresetId: id !== null && s.presets.some((p) => p.id === id) ? id : null,
        })),
    }),
    {
      name: COMPETITION_PRESETS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      // The live programme is not persisted (it is the default at launch):
      // persisting the active preset would flag that default as « modifié ».
      partialize: (s) => ({ presets: s.presets }),
      merge: (persisted, current) => {
        const presets = resolvePresets(isRecord(persisted) ? persisted.presets : undefined);
        return {
          ...current,
          presets,
          activePresetId: presets.some((p) => p.id === current.activePresetId)
            ? current.activePresetId
            : null,
        };
      },
    },
  ),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec jest src/stores/__tests__/competitionPresets.store.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/stores/competitionPresets.store.ts apps/client/src/stores/__tests__/competitionPresets.store.test.ts
```

```bash
git commit -m "feat(competition): persisted store of program presets

Refs #335

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Load and compare a preset program

**Files:**

- Modify: `apps/client/src/features/performance/utils/competitionProgram.ts` (store import at the top; new « Presets » section after the « Programme edition » section, before `// --- Playlist`)
- Test: `apps/client/src/features/performance/utils/__tests__/competitionProgram.test.ts` (add to the existing import from `../competitionProgram`; append two `describe` blocks at the end of the file)

**Interfaces:**

- Consumes: `createDefaultConfig`, `createRoundId`, `MAX_ROUND_GROUPS`, `MIN_ROUND_GROUPS`, `type Category`, `type PerformanceConfig`, `type RoundConfig` from `stores/performance.store.ts`; existing `normalizeRound` (official order by default, drops unknown dances, dedupes).
- Produces:
  - `export const configFromPreset = (saved: unknown): PerformanceConfig` — always a valid config, fresh round ids, no array shared with `saved`.
  - `export const isSameProgram = (a: PerformanceConfig, b: PerformanceConfig): boolean` — ignores round ids and the order of dances inside a category; compares round type, groups (in order), dances (as sets), `duration`, `pauseDuration`, `pasoClashes`, `announcements`.

- [ ] **Step 1: Write the failing tests**

Add `configFromPreset` and `isSameProgram` to the existing `import { … } from "../competitionProgram";` list (the file already imports `createDefaultConfig`, `createRound`, `MAX_ROUND_GROUPS` and `type PerformanceConfig` from the store). Append:

```ts
describe('configFromPreset', () => {
  const saved: PerformanceConfig = {
    rounds: [
      {
        id: 'old-1',
        type: 'Final',
        groups: ['Standard', 'Latin'],
        dances: { Standard: ['Tango', 'Valse Lente'], Latin: ['Jive'] },
      },
    ],
    duration: 75,
    pauseDuration: 20,
    pasoClashes: 3,
    announcements: false,
  };

  it('restores a valid preset with fresh round ids', () => {
    const cfg = configFromPreset(saved);
    expect(cfg).toMatchObject({
      duration: 75,
      pauseDuration: 20,
      pasoClashes: 3,
      announcements: false,
    });
    expect(cfg.rounds).toHaveLength(1);
    expect(cfg.rounds[0]).toMatchObject({
      type: 'Final',
      groups: ['Standard', 'Latin'],
      dances: { Standard: ['Valse Lente', 'Tango'], Latin: ['Jive'] },
    });
    expect(cfg.rounds[0].id).not.toBe('old-1');
    expect(isSameProgram(cfg, saved)).toBe(true);
  });

  it('gives every load its own round ids', () => {
    expect(configFromPreset(saved).rounds[0].id).not.toBe(configFromPreset(saved).rounds[0].id);
  });

  it('never shares an array with the saved preset', () => {
    const cfg = configFromPreset(saved);
    cfg.rounds[0].groups.push('Latin');
    cfg.rounds[0].dances.Latin.push('Samba');
    expect(saved.rounds[0].groups).toEqual(['Standard', 'Latin']);
    expect(saved.rounds[0].dances.Latin).toEqual(['Jive']);
  });

  it('falls back to the defaults for garbage', () => {
    for (const garbage of [undefined, null, 42, 'x', [], {}]) {
      expect(isSameProgram(configFromPreset(garbage), createDefaultConfig())).toBe(true);
    }
  });

  it('keeps only the valid fields of a partial preset', () => {
    const defaults = createDefaultConfig();
    const cfg = configFromPreset({
      duration: 60,
      pauseDuration: -5,
      pasoClashes: 4,
      announcements: 'yes',
      rounds: 'x',
    });
    expect(cfg).toMatchObject({
      duration: 60,
      pauseDuration: defaults.pauseDuration,
      pasoClashes: defaults.pasoClashes,
      announcements: defaults.announcements,
    });
    expect(cfg.rounds).toHaveLength(1);
    expect(cfg.rounds[0].groups).toEqual(['Latin', 'Latin']);
    expect(configFromPreset({ duration: Number.NaN }).duration).toBe(defaults.duration);
    expect(configFromPreset({ duration: Infinity }).duration).toBe(defaults.duration);
  });

  it('drops unknown dances and categories, and rounds left without a group', () => {
    const cfg = configFromPreset({
      rounds: [
        {
          type: 'Quarter',
          groups: ['Latin', 'Disco'],
          dances: { Latin: ['Jive', 'Lindy Hop', 'Jive', 3], Standard: 'x' },
        },
        { type: 'Round', groups: ['Disco'], dances: {} },
        'garbage',
      ],
    });
    expect(cfg.rounds).toHaveLength(1);
    expect(cfg.rounds[0]).toMatchObject({
      type: 'Round',
      groups: ['Latin'],
      dances: { Standard: [], Latin: ['Jive'] },
    });
  });

  it('caps the groups of a round', () => {
    const cfg = configFromPreset({
      rounds: [
        {
          type: 'Round',
          groups: Array.from({ length: 15 }, () => 'Standard'),
          dances: { Standard: ['Tango'], Latin: [] },
        },
      ],
    });
    expect(cfg.rounds[0].groups).toHaveLength(MAX_ROUND_GROUPS);
  });

  it('uses the default round when no saved round is usable', () => {
    const cfg = configFromPreset({ rounds: [{ groups: [] }], duration: 60 });
    expect(cfg.duration).toBe(60);
    expect(cfg.rounds).toHaveLength(1);
    expect(cfg.rounds[0]).toMatchObject({
      type: 'Round',
      groups: ['Latin', 'Latin'],
    });
  });
});

describe('isSameProgram', () => {
  const base = createDefaultConfig();

  it('ignores round ids', () => {
    const other = {
      ...base,
      rounds: base.rounds.map((r) => ({ ...r, id: 'other' })),
    };
    expect(isSameProgram(base, other)).toBe(true);
  });

  it('ignores the order of the dances inside a category', () => {
    const reversed = {
      ...base,
      rounds: [
        {
          ...base.rounds[0],
          dances: {
            ...base.rounds[0].dances,
            Latin: [...base.rounds[0].dances.Latin].reverse(),
          },
        },
      ],
    };
    expect(isSameProgram(base, reversed)).toBe(true);
  });

  it('detects every change of the programme', () => {
    const round = base.rounds[0];
    const changed: PerformanceConfig[] = [
      { ...base, duration: 60 },
      { ...base, pauseDuration: 5 },
      { ...base, pasoClashes: 3 },
      { ...base, announcements: false },
      { ...base, rounds: [...base.rounds, createRound('Standard')] },
      { ...base, rounds: [{ ...round, type: 'Final' }] },
      { ...base, rounds: [{ ...round, groups: ['Latin'] }] },
      { ...base, rounds: [{ ...round, groups: ['Standard', 'Latin'] }] },
      {
        ...base,
        rounds: [{ ...round, dances: { ...round.dances, Latin: ['Samba'] } }],
      },
    ];
    for (const c of changed) {
      expect(isSameProgram(base, c)).toBe(false);
      expect(isSameProgram(c, base)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec jest src/features/performance/utils/__tests__/competitionProgram.test.ts`
Expected: FAIL — TypeScript/Jest error: `configFromPreset` / `isSameProgram` is not exported (`is not a function`).

- [ ] **Step 3: Write minimal implementation**

In `competitionProgram.ts`, extend the store import at the top:

```ts
import {
  createDefaultConfig,
  createRound,
  createRoundId,
  MAX_ROUND_GROUPS,
  MIN_ROUND_GROUPS,
  type Category,
  type PerformanceConfig,
  type PlaylistItem,
  type RoundConfig,
} from '../../../stores/performance.store';
```

Then insert this section right before `// --- Playlist ---…`:

```ts
// --- Presets ----------------------------------------------------------------

const PROGRAM_CATEGORIES: readonly Category[] = ['Standard', 'Latin'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isPositiveNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

const isCategory = (v: unknown): v is Category => PROGRAM_CATEGORIES.includes(v as Category);

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string') : [];

/** One saved round rebuilt with a fresh id, or null without a usable group. */
const roundFromPreset = (saved: unknown): RoundConfig | null => {
  if (!isRecord(saved)) return null;
  const groups = Array.isArray(saved.groups)
    ? saved.groups.filter(isCategory).slice(0, MAX_ROUND_GROUPS)
    : [];
  if (groups.length < MIN_ROUND_GROUPS) return null;
  const dances = isRecord(saved.dances) ? saved.dances : {};
  return normalizeRound({
    id: createRoundId(),
    type: saved.type === 'Final' ? 'Final' : 'Round',
    groups,
    dances: {
      Standard: stringList(dances.Standard),
      Latin: stringList(dances.Latin),
    },
  });
};

/**
 * Rebuilds a live programme from a saved preset, field by field: anything
 * missing or invalid (stale storage, older shape) falls back to the default,
 * unknown dances and categories are dropped, and every round gets a fresh id
 * so the loaded programme never shares a reference with the stored one.
 */
export const configFromPreset = (saved: unknown): PerformanceConfig => {
  const defaults = createDefaultConfig();
  if (!isRecord(saved)) return defaults;
  const rounds = Array.isArray(saved.rounds)
    ? saved.rounds.map(roundFromPreset).filter((r): r is RoundConfig => r !== null)
    : [];
  return {
    rounds: rounds.length > 0 ? rounds : defaults.rounds,
    duration: isPositiveNumber(saved.duration) ? saved.duration : defaults.duration,
    pauseDuration: isPositiveNumber(saved.pauseDuration)
      ? saved.pauseDuration
      : defaults.pauseDuration,
    pasoClashes:
      saved.pasoClashes === 2 || saved.pasoClashes === 3 ? saved.pasoClashes : defaults.pasoClashes,
    announcements:
      typeof saved.announcements === 'boolean' ? saved.announcements : defaults.announcements,
  };
};

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const sameSet = (a: readonly string[], b: readonly string[]) =>
  sameList([...a].sort(), [...b].sort());

/**
 * True when two programmes are the same, round ids aside (a loaded preset
 * gets fresh ids). Groups are compared in floor order; the dances of a
 * category as a set (their order is the global dance order setting).
 */
export const isSameProgram = (a: PerformanceConfig, b: PerformanceConfig): boolean =>
  a.duration === b.duration &&
  a.pauseDuration === b.pauseDuration &&
  a.pasoClashes === b.pasoClashes &&
  a.announcements === b.announcements &&
  a.rounds.length === b.rounds.length &&
  a.rounds.every((round, i) => {
    const other = b.rounds[i];
    return (
      round.type === other.type &&
      sameList(round.groups, other.groups) &&
      PROGRAM_CATEGORIES.every((c) => sameSet(round.dances[c], other.dances[c]))
    );
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec jest src/features/performance/utils/__tests__/competitionProgram.test.ts`
Expected: PASS (existing tests + 11 new).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/features/performance/utils/competitionProgram.ts apps/client/src/features/performance/utils/__tests__/competitionProgram.test.ts
```

```bash
git commit -m "feat(competition): rebuild and compare preset programs

Refs #335

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Presets sheet

**Files:**

- Create: `apps/client/src/features/performance/components/PresetsSheet.tsx`
- Test: `apps/client/src/features/performance/components/__tests__/PresetsSheet.test.tsx`

**Interfaces:**

- Consumes (Task 1): `type CompetitionPreset`, `type SaveResult`, `findPresetByName`, `MAX_PRESETS`, `PRESET_NAME_MAX_LENGTH` from `stores/competitionPresets.store.ts`. Shared UI: `AppButton`, `AppText`, `radii`, `useTheme` (same bottom-sheet structure as `components/FilterSheet.tsx`).
- Produces:
  - `export const formatPresetDate = (iso: string): string` — `"DD/MM/YYYY"` in local time, `""` when invalid.
  - `export const PresetsSheet: React.FC<PresetsSheetProps>` with props `{ visible: boolean; presets: readonly CompetitionPreset[]; activePresetId: string | null; onClose: () => void; onLoad: (preset: CompetitionPreset) => void; onSave: (name: string) => SaveResult; onReplace: (id: string) => void; onRename: (id: string, name: string) => SaveResult; onDelete: (id: string) => void }`.
  - testIDs used by Task 4: `performance-presets-close`, `performance-presets-save`, `performance-presets-name-input`, `performance-presets-form-confirm`, `performance-presets-form-cancel`, `performance-presets-error`, `performance-presets-empty`, `performance-preset-<id>`, `performance-preset-<id>-load|rename|delete`.
  - Behaviour: « Charger » calls `onLoad` then `onClose`; a successful save/rename closes the form but keeps the sheet open.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { useTheme } from '../../../../context/ThemeContext';
import type { CompetitionPreset, SaveResult } from '../../../../stores/competitionPresets.store';
import { createDefaultConfig } from '../../../../stores/performance.store';
import { formatPresetDate, PresetsSheet } from '../PresetsSheet';

jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: jest.fn(),
}));

const SAVED_AT = new Date(2026, 9, 11, 12).toISOString();
const preset = (id: string, name: string): CompetitionPreset => ({
  id,
  name,
  updatedAt: SAVED_AT,
  config: createDefaultConfig(),
});
const GALA = preset('p1', 'Gala');
const TRAINING = preset('p2', 'Entraînement');

const renderSheet = async (overrides: Partial<React.ComponentProps<typeof PresetsSheet>> = {}) => {
  const props = {
    visible: true,
    presets: [GALA, TRAINING],
    activePresetId: null,
    onClose: jest.fn(),
    onLoad: jest.fn(),
    onSave: jest.fn((): SaveResult => ({ ok: true, id: 'new' })),
    onReplace: jest.fn(),
    onRename: jest.fn((): SaveResult => ({ ok: true, id: 'p1' })),
    onDelete: jest.fn(),
    ...overrides,
  };
  const screen = await render(<PresetsSheet {...props} />);
  return { props, ...screen };
};

/** Presses a button of the last Alert shown. */
const pressAlertButton = async (text: string) => {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1][2] as AlertButton[];
  await act(async () => {
    buttons.find((b) => b.text === text)?.onPress?.();
  });
};

describe('formatPresetDate', () => {
  it('formats a local day', () => {
    expect(formatPresetDate(SAVED_AT)).toBe('11/10/2026');
  });
  it('returns an empty string for an invalid date', () => {
    expect(formatPresetDate('garbage')).toBe('');
  });
});

describe('PresetsSheet', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (useTheme as jest.Mock).mockReturnValue({
      theme: {
        background: '#fff',
        surface: '#f2f2f2',
        text: '#111',
        textSecondary: '#666',
        primary: '#3b82f6',
        border: '#e5e7eb',
        danger: '#ef4444',
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists the presets with their save date and marks the active one', async () => {
    const { getByText, getAllByText } = await renderSheet({
      activePresetId: 'p2',
    });
    expect(getByText('Gala')).toBeTruthy();
    expect(getByText('Entraînement')).toBeTruthy();
    expect(getAllByText(/Enregistré le 11\/10\/2026/)).toHaveLength(2);
    expect(getByText(/En cours/)).toBeTruthy();
  });

  it('explains the empty list', async () => {
    const { getByTestId } = await renderSheet({ presets: [] });
    expect(getByTestId('performance-presets-empty')).toHaveTextContent(/Aucun preset enregistré/);
  });

  it('labels every action with the preset name', async () => {
    const { getByLabelText } = await renderSheet();
    expect(getByLabelText('Charger le preset Gala')).toBeTruthy();
    expect(getByLabelText('Renommer le preset Gala')).toBeTruthy();
    expect(getByLabelText('Supprimer le preset Gala')).toBeTruthy();
  });

  it('loads a preset and closes', async () => {
    const { getByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId('performance-preset-p1-load'));
    expect(props.onLoad).toHaveBeenCalledWith(GALA);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('saves the current programme under a name', async () => {
    const { getByTestId, queryByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId('performance-presets-save'));
    const input = getByTestId('performance-presets-name-input');
    expect(input.props.maxLength).toBe(40);
    await fireEvent.changeText(input, 'Championnat');
    await fireEvent.press(getByTestId('performance-presets-form-confirm'));
    expect(props.onSave).toHaveBeenCalledWith('Championnat');
    expect(queryByTestId('performance-presets-name-input')).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('asks for a name', async () => {
    const { getByTestId } = await renderSheet({
      onSave: jest.fn((): SaveResult => ({ ok: false, reason: 'empty' })),
    });
    await fireEvent.press(getByTestId('performance-presets-save'));
    await fireEvent.press(getByTestId('performance-presets-form-confirm'));
    expect(getByTestId('performance-presets-error')).toHaveTextContent('Donnez un nom au preset.');
  });

  it('explains the list is full', async () => {
    const { getByTestId } = await renderSheet({
      onSave: jest.fn((): SaveResult => ({ ok: false, reason: 'full' })),
    });
    await fireEvent.press(getByTestId('performance-presets-save'));
    await fireEvent.changeText(getByTestId('performance-presets-name-input'), 'Nouveau');
    await fireEvent.press(getByTestId('performance-presets-form-confirm'));
    expect(getByTestId('performance-presets-error')).toHaveTextContent(/20 presets maximum/);
  });

  it('offers to replace a preset with the same name', async () => {
    const { getByTestId, queryByTestId, props } = await renderSheet({
      onSave: jest.fn((): SaveResult => ({ ok: false, reason: 'duplicate' })),
    });
    await fireEvent.press(getByTestId('performance-presets-save'));
    await fireEvent.changeText(getByTestId('performance-presets-name-input'), ' gala ');
    await fireEvent.press(getByTestId('performance-presets-form-confirm'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Remplacer ?',
      expect.stringContaining('« Gala »'),
      expect.any(Array),
    );
    expect(props.onReplace).not.toHaveBeenCalled();
    await pressAlertButton('Remplacer');
    expect(props.onReplace).toHaveBeenCalledWith('p1');
    expect(queryByTestId('performance-presets-name-input')).toBeNull();
  });

  it('renames a preset', async () => {
    const { getByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId('performance-preset-p1-rename'));
    const input = getByTestId('performance-presets-name-input');
    expect(input.props.value).toBe('Gala');
    await fireEvent.changeText(input, 'Gala 2026');
    await fireEvent.press(getByTestId('performance-presets-form-confirm'));
    expect(props.onRename).toHaveBeenCalledWith('p1', 'Gala 2026');
  });

  it("refuses to rename to another preset's name", async () => {
    const { getByTestId } = await renderSheet({
      onRename: jest.fn(
        (): SaveResult => ({
          ok: false,
          reason: 'duplicate',
        }),
      ),
    });
    await fireEvent.press(getByTestId('performance-preset-p1-rename'));
    await fireEvent.press(getByTestId('performance-presets-form-confirm'));
    expect(getByTestId('performance-presets-error')).toHaveTextContent(
      'Un autre preset porte déjà ce nom.',
    );
  });

  it('cancels the form', async () => {
    const { getByTestId, queryByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId('performance-presets-save'));
    await fireEvent.press(getByTestId('performance-presets-form-cancel'));
    expect(queryByTestId('performance-presets-name-input')).toBeNull();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('deletes only after confirmation', async () => {
    const { getByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId('performance-preset-p1-delete'));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Supprimer le preset',
      expect.stringContaining('« Gala »'),
      expect.any(Array),
    );
    await pressAlertButton('Supprimer');
    expect(props.onDelete).toHaveBeenCalledWith('p1');
  });

  it('closes', async () => {
    const { getByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId('performance-presets-close'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('renders nothing when hidden', async () => {
    const { queryByTestId } = await renderSheet({ visible: false });
    expect(queryByTestId('performance-presets-save')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec jest src/features/performance/components/__tests__/PresetsSheet.test.tsx`
Expected: FAIL — `Cannot find module '../PresetsSheet'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { X } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppButton } from '../../../components/AppButton';
import { AppText } from '../../../components/AppText';
import { radii } from '../../../constants/radii';
import { useTheme } from '../../../context/ThemeContext';
import {
  findPresetByName,
  MAX_PRESETS,
  PRESET_NAME_MAX_LENGTH,
  type CompetitionPreset,
  type SaveResult,
} from '../../../stores/competitionPresets.store';

interface PresetsSheetProps {
  visible: boolean;
  presets: readonly CompetitionPreset[];
  activePresetId: string | null;
  onClose: () => void;
  /** Loads the preset into the live programme. */
  onLoad: (preset: CompetitionPreset) => void;
  /** Saves the live programme under a new name. */
  onSave: (name: string) => SaveResult;
  /** Replaces the programme of an existing preset with the live one. */
  onReplace: (id: string) => void;
  onRename: (id: string, name: string) => SaveResult;
  onDelete: (id: string) => void;
}

type Form = { kind: 'save' } | { kind: 'rename'; id: string };

const ERRORS = {
  empty: 'Donnez un nom au preset.',
  full: `${MAX_PRESETS} presets maximum : supprimez-en un pour en enregistrer un nouveau.`,
  renameDuplicate: 'Un autre preset porte déjà ce nom.',
} as const;

/** « 11/10/2026 » — local day of an ISO timestamp ("" when invalid). */
export const formatPresetDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};

interface RowButtonProps {
  text: string;
  label: string;
  hint: string;
  color: string;
  testID: string;
  onPress: () => void;
}

const RowButton = ({ text, label, hint, color, testID, onPress }: RowButtonProps) => (
  <TouchableOpacity
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint={hint}
    hitSlop={6}
    testID={testID}
    style={styles.rowButton}
  >
    <AppText variant="caption" weight="600" color={color}>
      {text}
    </AppText>
  </TouchableOpacity>
);

/**
 * Bottom sheet of the competition presets: load, rename or delete a saved
 * programme, or save the live one under a name. Presentational — the screen
 * owns the store and the live programme.
 */
export const PresetsSheet: React.FC<PresetsSheetProps> = ({
  visible,
  presets,
  activePresetId,
  onClose,
  onLoad,
  onSave,
  onReplace,
  onRename,
  onDelete,
}) => {
  const { theme } = useTheme();
  const [form, setForm] = useState<Form | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const closeForm = () => {
    setForm(null);
    setName('');
    setError(null);
  };

  const close = () => {
    closeForm();
    onClose();
  };

  const openForm = (next: Form, initialName: string) => {
    setForm(next);
    setName(initialName);
    setError(null);
  };

  const confirmReplace = (existing: CompetitionPreset) =>
    Alert.alert(
      'Remplacer ?',
      `Un preset « ${existing.name} » existe déjà. Le remplacer par le programme actuel ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Remplacer',
          style: 'destructive',
          onPress: () => {
            onReplace(existing.id);
            closeForm();
          },
        },
      ],
    );

  const confirmDelete = (preset: CompetitionPreset) =>
    Alert.alert(
      'Supprimer le preset',
      `Supprimer « ${preset.name} » ? Le programme affiché n'est pas modifié.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => onDelete(preset.id),
        },
      ],
    );

  const submit = () => {
    if (!form) return;
    if (form.kind === 'rename') {
      const result = onRename(form.id, name);
      if (result.ok) closeForm();
      else setError(result.reason === 'empty' ? ERRORS.empty : ERRORS.renameDuplicate);
      return;
    }
    const result = onSave(name);
    if (result.ok) {
      closeForm();
      return;
    }
    if (result.reason === 'duplicate') {
      const existing = findPresetByName(presets, name);
      if (existing) confirmReplace(existing);
      return;
    }
    setError(result.reason === 'empty' ? ERRORS.empty : ERRORS.full);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Fermer les presets"
          accessibilityHint="Ferme la liste des presets"
        >
          <Pressable
            style={[styles.card, { backgroundColor: theme.surface }]}
            onPress={() => {}}
            accessibilityRole="none"
          >
            <View style={styles.header}>
              <AppText variant="h3" color={theme.text} style={styles.title}>
                Presets
              </AppText>
              <TouchableOpacity
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Fermer"
                accessibilityHint="Ferme la liste des presets"
                hitSlop={8}
                testID="performance-presets-close"
              >
                <X size={22} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {presets.length === 0 && (
                <AppText
                  variant="caption"
                  color={theme.textSecondary}
                  testID="performance-presets-empty"
                >
                  Aucun preset enregistré. Enregistrez le programme actuel pour le retrouver en un
                  geste.
                </AppText>
              )}
              {presets.map((preset) => {
                const active = preset.id === activePresetId;
                const prefix = `performance-preset-${preset.id}`;
                return (
                  <View
                    key={preset.id}
                    testID={prefix}
                    style={[styles.row, { borderColor: active ? theme.primary : theme.border }]}
                  >
                    <View style={styles.rowText}>
                      <AppText variant="body" weight="600" color={theme.text}>
                        {preset.name}
                      </AppText>
                      <AppText variant="caption" color={theme.textSecondary}>
                        {active ? 'En cours · ' : ''}Enregistré le{' '}
                        {formatPresetDate(preset.updatedAt)}
                      </AppText>
                    </View>
                    <View style={styles.rowActions}>
                      <RowButton
                        text="Charger"
                        label={`Charger le preset ${preset.name}`}
                        hint="Remplace le programme affiché par ce preset"
                        color={theme.primary}
                        testID={`${prefix}-load`}
                        onPress={() => {
                          onLoad(preset);
                          close();
                        }}
                      />
                      <RowButton
                        text="Renommer"
                        label={`Renommer le preset ${preset.name}`}
                        hint="Change le nom de ce preset"
                        color={theme.text}
                        testID={`${prefix}-rename`}
                        onPress={() => openForm({ kind: 'rename', id: preset.id }, preset.name)}
                      />
                      <RowButton
                        text="Supprimer"
                        label={`Supprimer le preset ${preset.name}`}
                        hint="Supprime ce preset après confirmation"
                        color={theme.danger}
                        testID={`${prefix}-delete`}
                        onPress={() => confirmDelete(preset)}
                      />
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            {form ? (
              <View style={styles.form}>
                <AppText variant="caption" color={theme.textSecondary}>
                  {form.kind === 'save' ? 'Nom du preset' : 'Nouveau nom'}
                </AppText>
                <TextInput
                  testID="performance-presets-name-input"
                  accessibilityLabel="Nom du preset"
                  accessibilityHint={`${PRESET_NAME_MAX_LENGTH} caractères maximum`}
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    setError(null);
                  }}
                  maxLength={PRESET_NAME_MAX_LENGTH}
                  autoFocus
                  placeholder="Ex. Championnat de France"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  style={[
                    styles.input,
                    {
                      color: theme.text,
                      borderColor: theme.border,
                      backgroundColor: theme.background,
                    },
                  ]}
                />
                {error && (
                  <AppText
                    variant="caption"
                    color={theme.danger}
                    testID="performance-presets-error"
                    accessibilityLiveRegion="polite"
                  >
                    {error}
                  </AppText>
                )}
                <View style={styles.formActions}>
                  <AppButton
                    title="Annuler"
                    variant="secondary"
                    onPress={closeForm}
                    style={styles.formButton}
                    testID="performance-presets-form-cancel"
                    accessibilityLabel="Annuler"
                    accessibilityHint="Ferme le formulaire sans rien enregistrer"
                  />
                  <AppButton
                    title={form.kind === 'save' ? 'Enregistrer' : 'Renommer'}
                    onPress={submit}
                    style={styles.formButton}
                    testID="performance-presets-form-confirm"
                    accessibilityLabel={
                      form.kind === 'save' ? 'Enregistrer le preset' : 'Renommer le preset'
                    }
                    accessibilityHint={
                      form.kind === 'save'
                        ? 'Enregistre le programme actuel sous ce nom'
                        : 'Donne ce nom au preset'
                    }
                  />
                </View>
              </View>
            ) : (
              <AppButton
                title="Enregistrer le programme actuel"
                variant="outline"
                onPress={() => openForm({ kind: 'save' }, '')}
                style={styles.saveButton}
                testID="performance-presets-save"
                accessibilityLabel="Enregistrer le programme actuel"
                accessibilityHint="Enregistre le programme configuré sous un nom"
              />
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { flex: 1 },
  body: { flexShrink: 1 },
  row: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  rowText: { gap: 2 },
  rowActions: { flexDirection: 'row', gap: 16 },
  rowButton: { paddingVertical: 4 },
  form: { marginTop: 12, gap: 8 },
  input: {
    padding: 12,
    borderRadius: radii.md,
    fontSize: 16,
    borderWidth: 1,
  },
  formActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  formButton: { flex: 1 },
  saveButton: { marginTop: 12 },
});
```

`theme.danger` is part of `AppTheme` (`context/ThemeContext.tsx`) and already used for destructive actions (e.g. `CompetitionEventsTab.tsx`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec jest src/features/performance/components/__tests__/PresetsSheet.test.tsx`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/features/performance/components/PresetsSheet.tsx apps/client/src/features/performance/components/__tests__/PresetsSheet.test.tsx
```

```bash
git commit -m "feat(competition): presets sheet to load, save, rename and delete programs

Refs #335

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Preset banner on the setup screen

**Files:**

- Create: `apps/client/src/features/performance/components/PresetBanner.tsx`
- Modify: `apps/client/src/features/performance/screens/PerformanceSetupScreen.tsx` (imports; store selectors after the `danceOrder` selectors; banner as first child of the `ScrollView`; sheet after the `ScrollView`)
- Test: `apps/client/src/features/performance/screens/__tests__/PerformanceSetupScreen.test.tsx` (top-level `beforeEach` + new `describe("presets")` at the end)

**Interfaces:**

- Consumes: Task 1 `useCompetitionPresetsStore` (`presets`, `activePresetId`, `save`, `overwrite`, `rename`, `remove`, `setActive`) and `type CompetitionPreset`; Task 2 `configFromPreset`, `isSameProgram`; Task 3 `PresetsSheet` and its testIDs; engine `config`, `setConfig`, `status` from `usePerformanceEngine`.
- Produces:
  - `export const PresetBanner: React.FC<{ presetName: string | null; modified: boolean; disabled: boolean; onOpen: () => void; onUpdate: () => void }>`
  - testIDs: `performance-preset-banner`, `performance-preset-banner-title`, `performance-preset-modified`, `performance-preset-update`, `performance-presets-open`.

- [ ] **Step 1: Write the failing test**

In `PerformanceSetupScreen.test.tsx`, add the imports:

```tsx
import { useCompetitionPresetsStore } from '../../../../stores/competitionPresets.store';
import { configFromPreset, isSameProgram } from '../../utils/competitionProgram';
```

Add to the top-level `beforeEach` (after the `useDanceOrderStore.setState(…)` line):

```tsx
useCompetitionPresetsStore.setState({ presets: [], activePresetId: null });
```

Append inside the top-level `describe("PerformanceSetupScreen", …)`, after `describe("dance order", …)`:

```tsx
describe('presets', () => {
  const presets = () => useCompetitionPresetsStore.getState();

  it('shows a custom programme when no preset is active', async () => {
    const { getByTestId, queryByTestId } = await render(<PerformanceSetupScreen />);
    expect(getByTestId('performance-preset-banner-title')).toHaveTextContent(
      'Programme personnalisé',
    );
    expect(queryByTestId('performance-preset-modified')).toBeNull();
    expect(queryByTestId('performance-preset-update')).toBeNull();
  });

  it('saves the programme, then loads it back', async () => {
    const { setConfig } = mockEngine();
    const { getByTestId, queryByTestId, rerender } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId('performance-presets-open'));
    await fireEvent.press(getByTestId('performance-presets-save'));
    await fireEvent.changeText(getByTestId('performance-presets-name-input'), 'Gala');
    await fireEvent.press(getByTestId('performance-presets-form-confirm'));

    const [saved] = presets().presets;
    expect(saved.name).toBe('Gala');
    expect(isSameProgram(saved.config, baseConfig)).toBe(true);
    expect(getByTestId('performance-preset-banner-title')).toHaveTextContent('Preset : Gala');

    // The user builds another programme, then reloads the preset.
    mockEngine({
      config: { ...baseConfig, rounds: [standard], duration: 60 },
      setConfig,
    });
    await rerender(<PerformanceSetupScreen />);
    expect(getByTestId('performance-preset-modified')).toBeTruthy();
    await fireEvent.press(getByTestId(`performance-preset-${saved.id}-load`));

    const loaded = applyLast(setConfig);
    expect(isSameProgram(loaded, baseConfig)).toBe(true);
    expect(loaded.rounds[0].id).not.toBe('r1');
    expect(presets().activePresetId).toBe(saved.id);
    expect(queryByTestId(`performance-preset-${saved.id}`)).toBeNull();
  });

  it('is not flagged as modified right after a load', async () => {
    presets().save('Gala', baseConfig);
    mockEngine({ config: configFromPreset(baseConfig) });
    const { getByTestId, queryByTestId } = await render(<PerformanceSetupScreen />);
    expect(getByTestId('performance-preset-banner-title')).toHaveTextContent('Preset : Gala');
    expect(queryByTestId('performance-preset-modified')).toBeNull();
  });

  it('flags an edited preset as modified, and « Mettre à jour » saves it', async () => {
    presets().save('Gala', baseConfig);
    mockEngine({ config: { ...baseConfig, duration: 45 } });
    const { getByTestId, queryByTestId } = await render(<PerformanceSetupScreen />);
    expect(getByTestId('performance-preset-modified')).toHaveTextContent('modifié');

    await fireEvent.press(getByTestId('performance-preset-update'));

    expect(presets().presets[0].config.duration).toBe(45);
    expect(queryByTestId('performance-preset-modified')).toBeNull();
  });

  it.each(['loading', 'break', 'playing', 'paused'] as const)(
    'locks the presets while the competition is %s',
    async (status) => {
      presets().save('Gala', baseConfig);
      mockEngine({ status, config: { ...baseConfig, duration: 45 } });
      const { getByTestId, queryByTestId } = await render(<PerformanceSetupScreen />);
      expect(getByTestId('performance-presets-open')).toBeDisabled();
      expect(getByTestId('performance-preset-update')).toBeDisabled();
      await fireEvent.press(getByTestId('performance-presets-open'));
      expect(queryByTestId('performance-presets-save')).toBeNull();
    },
  );

  it('unlocks the presets once the competition is finished', async () => {
    mockEngine({ status: 'finished' });
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    expect(getByTestId('performance-presets-open')).not.toBeDisabled();
  });
});
```

If TypeScript rejects `status` in `mockEngine({ status, … })` (the override type is `Partial<ReturnType<typeof usePerformanceEngine>>`, whose `status` is the store status union), the `as const` on the `it.each` table already narrows it — do not widen to `string`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec jest src/features/performance/screens/__tests__/PerformanceSetupScreen.test.tsx`
Expected: FAIL — the new `presets` tests fail with `Unable to find an element with testID: performance-preset-banner-title` (existing tests still PASS).

- [ ] **Step 3: Create the banner**

`apps/client/src/features/performance/components/PresetBanner.tsx`:

```tsx
import { Bookmark } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText } from '../../../components/AppText';
import { radii } from '../../../constants/radii';
import { useTheme } from '../../../context/ThemeContext';

interface PresetBannerProps {
  /** Name of the active preset, null for a custom programme. */
  presetName: string | null;
  /** The live programme differs from the active preset. */
  modified: boolean;
  /** A competition is loading or running: presets cannot be touched. */
  disabled: boolean;
  onOpen: () => void;
  /** Saves the live programme into the active preset. */
  onUpdate: () => void;
}

/** Top of the setup screen: which preset the programme comes from. */
export const PresetBanner: React.FC<PresetBannerProps> = ({
  presetName,
  modified,
  disabled,
  onOpen,
  onUpdate,
}) => {
  const { theme } = useTheme();
  const opacity = disabled ? 0.4 : 1;
  return (
    <View
      testID="performance-preset-banner"
      style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <View style={styles.text}>
        <AppText
          variant="body"
          weight="600"
          color={theme.text}
          numberOfLines={1}
          testID="performance-preset-banner-title"
        >
          {presetName ? `Preset : ${presetName}` : 'Programme personnalisé'}
        </AppText>
        {modified && (
          <AppText variant="caption" color={theme.primary} testID="performance-preset-modified">
            modifié
          </AppText>
        )}
      </View>
      {modified && presetName && (
        <TouchableOpacity
          onPress={onUpdate}
          disabled={disabled}
          testID="performance-preset-update"
          accessibilityRole="button"
          accessibilityLabel={`Mettre à jour le preset ${presetName}`}
          accessibilityHint="Enregistre le programme actuel dans ce preset"
          accessibilityState={{ disabled }}
          hitSlop={6}
          style={[styles.action, { opacity }]}
        >
          <AppText variant="caption" weight="600" color={theme.primary}>
            Mettre à jour
          </AppText>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={onOpen}
        disabled={disabled}
        testID="performance-presets-open"
        accessibilityRole="button"
        accessibilityLabel="Presets"
        accessibilityHint="Charge, enregistre ou gère les programmes enregistrés"
        accessibilityState={{ disabled }}
        hitSlop={6}
        style={[styles.action, styles.open, { opacity }]}
      >
        <Bookmark size={16} color={theme.primary} />
        <AppText variant="caption" weight="600" color={theme.primary}>
          Presets
        </AppText>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  text: { flex: 1, gap: 2 },
  action: { paddingVertical: 4 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
```

- [ ] **Step 4: Wire banner and sheet in the setup screen**

In `PerformanceSetupScreen.tsx`:

1. React import: `import React, { useEffect, useMemo, useRef, useState } from "react";`
2. Add imports next to the other component / store imports:

```tsx
import { PresetBanner } from '../components/PresetBanner';
import { PresetsSheet } from '../components/PresetsSheet';
import {
  useCompetitionPresetsStore,
  type CompetitionPreset,
} from '../../../stores/competitionPresets.store';
```

3. Add `configFromPreset` and `isSameProgram` to the existing `import { … } from "../utils/competitionProgram";` list.
4. Right after the `const resetDanceOrder = …` line, add:

```tsx
const presets = useCompetitionPresetsStore((s) => s.presets);
const activePresetId = useCompetitionPresetsStore((s) => s.activePresetId);
const savePreset = useCompetitionPresetsStore((s) => s.save);
const overwritePreset = useCompetitionPresetsStore((s) => s.overwrite);
const renamePreset = useCompetitionPresetsStore((s) => s.rename);
const removePreset = useCompetitionPresetsStore((s) => s.remove);
const setActivePreset = useCompetitionPresetsStore((s) => s.setActive);
const [presetsOpen, setPresetsOpen] = useState(false);
// Presets are frozen while a competition is loading or running.
const presetsLocked = status !== 'idle' && status !== 'finished';
const activePreset = presets.find((p) => p.id === activePresetId) ?? null;
// Compared through configFromPreset: the stored data may predate the
// current shape, and the live programme always went through it on load.
const presetModified = useMemo(
  () => activePreset !== null && !isSameProgram(config, configFromPreset(activePreset.config)),
  [activePreset, config],
);
const loadPreset = (preset: CompetitionPreset) => {
  setConfig(configFromPreset(preset.config));
  setActivePreset(preset.id);
};
```

5. First child of the `<ScrollView …>` (before the `{/* Programme de tours */}` block):

```tsx
<PresetBanner
  presetName={activePreset?.name ?? null}
  modified={presetModified}
  disabled={presetsLocked}
  onOpen={() => setPresetsOpen(true)}
  onUpdate={() => {
    if (activePreset) overwritePreset(activePreset.id, config);
  }}
/>
```

6. Between `</ScrollView>` and `<PinnedHeader …>`:

```tsx
<PresetsSheet
  visible={presetsOpen && !presetsLocked}
  presets={presets}
  activePresetId={activePresetId}
  onClose={() => setPresetsOpen(false)}
  onLoad={loadPreset}
  onSave={(name) => savePreset(name, config)}
  onReplace={(id) => overwritePreset(id, config)}
  onRename={renamePreset}
  onDelete={removePreset}
/>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter client exec jest src/features/performance src/stores`
Expected: all PASS (the existing setup-screen tests are unaffected: the banner adds testIDs only).

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/features/performance/components/PresetBanner.tsx apps/client/src/features/performance/screens/PerformanceSetupScreen.tsx apps/client/src/features/performance/screens/__tests__/PerformanceSetupScreen.test.tsx
```

```bash
git commit -m "feat(competition): load and save program presets from the setup screen

Refs #335

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Full client checks

**Files:** none (fix-ups only if a check fails)

- [ ] **Step 1: Typecheck, lint, format, client tests**

Run:

```bash
pnpm typecheck
pnpm --filter client lint
pnpm format:check
pnpm --filter client test
```

Expected: all green. If `format:check` fails on the new files, run `./node_modules/.bin/prettier --write <files>` from the worktree root and re-run. If a snapshot or a11y lint rule flags the new buttons, fix the component, never disable the rule.

- [ ] **Step 2: Manual check on the simulator (optional, if a dev build is at hand)**

Mode Compétition → « Presets » → « Enregistrer le programme actuel » → « Gala » → change the duration → banner shows « modifié » → « Mettre à jour » → kill and relaunch the app → « Programme personnalisé », « Gala » still in the list → « Charger ».

- [ ] **Step 3: Commit fix-ups if any**

```bash
git add apps/client/src
```

```bash
git commit -m "chore(competition): lint and format fix-ups for presets

Refs #335

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: PR

- [ ] **Step 1: Push and open the PR on `develop`** — only once Gabin agreed to push. Never merge without his explicit go, even with a green CI.

Title: `feat(competition): save and reload competition program presets`
Body follows `.github/pull_request_template.md`: `Refs #335` (user-visible change: the issue is closed by hand after beta validation); summary (store + `configFromPreset` / `isSameProgram` + sheet + banner; the 4 deliberate deviations listed at the top of this plan); « Pour les testeurs » in French:

```
- Mode compétition : vous pouvez enregistrer le programme configuré (tours, groupes, danses, durées, clashs du Paso, annonces) sous un nom avec le bouton « Presets », puis le recharger en un geste lors d'une prochaine séance. À vérifier : enregistrer un programme, le modifier (le bandeau indique « modifié »), « Mettre à jour », fermer puis rouvrir l'app et recharger le preset. Les presets restent sur le téléphone (pas de partage entre appareils).
```

Test plan: the 4 test files of this plan (`competitionPresets.store.test.ts`, `competitionProgram.test.ts`, `PresetsSheet.test.tsx`, `PerformanceSetupScreen.test.tsx`) + Task 5 checks + the manual check of Task 5 Step 2 if done.
End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
