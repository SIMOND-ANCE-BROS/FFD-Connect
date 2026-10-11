import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PerformanceConfig } from "./performance.store";

/** Most presets a device keeps. */
export const MAX_PRESETS = 20;
/** Longest preset name, in characters (longer names are truncated). */
export const PRESET_NAME_MAX_LENGTH = 40;
export const COMPETITION_PRESETS_STORAGE_KEY = "competition-presets";

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
  | { ok: false; reason: "empty" | "duplicate" | "full" };

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
  typeof v === "object" && v !== null && !Array.isArray(v);

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
    if (typeof id !== "string" || id === "") continue;
    if (kept.some((p) => p.id === id)) continue;
    if (typeof name !== "string" || cleanPresetName(name) === "") continue;
    if (!isRecord(config) || !Array.isArray(config.rounds)) continue;
    kept.push({
      id,
      name: cleanPresetName(name),
      updatedAt:
        typeof updatedAt === "string" && !Number.isNaN(Date.parse(updatedAt))
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
        if (clean === "") return { ok: false, reason: "empty" };
        const { presets } = get();
        // Duplicate before full: the UI then offers to replace that preset.
        if (findPresetByName(presets, clean)) {
          return { ok: false, reason: "duplicate" };
        }
        if (presets.length >= MAX_PRESETS) return { ok: false, reason: "full" };
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
        if (clean === "") return { ok: false, reason: "empty" };
        const other = findPresetByName(get().presets, clean);
        if (other && other.id !== id) {
          return { ok: false, reason: "duplicate" };
        }
        set((s) => ({
          presets: s.presets.map((p) =>
            p.id === id ? { ...p, name: clean } : p,
          ),
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
          activePresetId:
            id !== null && s.presets.some((p) => p.id === id) ? id : null,
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
        const presets = resolvePresets(
          isRecord(persisted) ? persisted.presets : undefined,
        );
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
