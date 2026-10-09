import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DANCES, type Category } from "./performance.store";

/** Dance order of each category, applied to every round of the programme. */
export type DanceOrder = Record<Category, readonly string[]>;

/** Official (FFD / WDSF) order: the default when nothing is saved. */
export const OFFICIAL_DANCE_ORDER: DanceOrder = DANCES;

const CATEGORIES: readonly Category[] = ["Standard", "Latin"];

/**
 * Turns any saved list into a full permutation of the category's dances:
 * unknown or duplicated entries are dropped, missing dances are appended in
 * official order. Guards against stale storage (e.g. a dance added later).
 */
export const resolveCategoryOrder = (
  category: Category,
  saved: readonly unknown[] | undefined,
): string[] => {
  const official = DANCES[category];
  const kept: string[] = [];
  for (const d of saved ?? []) {
    if (typeof d === "string" && official.includes(d) && !kept.includes(d)) {
      kept.push(d);
    }
  }
  return [...kept, ...official.filter((d) => !kept.includes(d))];
};

/** Sanitizes a (possibly partial or corrupted) persisted order. */
export const resolveDanceOrder = (saved: unknown): DanceOrder => {
  const record =
    typeof saved === "object" && saved !== null
      ? (saved as Partial<Record<Category, unknown>>)
      : {};
  const pick = (category: Category) => {
    const value = record[category];
    return resolveCategoryOrder(
      category,
      Array.isArray(value) ? (value as unknown[]) : undefined,
    );
  };
  return { Standard: pick("Standard"), Latin: pick("Latin") };
};

/** True when the category is danced in the official order. */
export const isOfficialOrder = (
  order: DanceOrder,
  category?: Category,
): boolean =>
  (category ? [category] : CATEGORIES).every((c) => {
    const resolved = resolveCategoryOrder(c, order[c]);
    return resolved.every((d, i) => d === DANCES[c][i]);
  });

interface DanceOrderState {
  danceOrder: DanceOrder;
  /** Replaces the order of one category (sanitized). */
  setCategoryOrder: (category: Category, order: readonly string[]) => void;
  /** Back to the official order — one category, or both when omitted. */
  resetDanceOrder: (category?: Category) => void;
}

export const DANCE_ORDER_STORAGE_KEY = "performance-dance-order";

/**
 * Dance order of the competition mode, persisted on the device: the last order
 * chosen becomes the default of the next session. Kept out of the performance
 * store on purpose — that one ticks every second during a competition and
 * persisting it would write to storage on every tick.
 */
export const useDanceOrderStore = create<DanceOrderState>()(
  persist(
    (set) => ({
      danceOrder: OFFICIAL_DANCE_ORDER,
      setCategoryOrder: (category, order) =>
        set((s) => ({
          danceOrder: {
            ...s.danceOrder,
            [category]: resolveCategoryOrder(category, order),
          },
        })),
      resetDanceOrder: (category) =>
        set((s) => ({
          danceOrder: category
            ? { ...s.danceOrder, [category]: DANCES[category] }
            : OFFICIAL_DANCE_ORDER,
        })),
    }),
    {
      name: DANCE_ORDER_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ danceOrder: s.danceOrder }),
      merge: (persisted, current) => ({
        ...current,
        danceOrder: resolveDanceOrder(
          typeof persisted === "object" && persisted !== null
            ? (persisted as { danceOrder?: unknown }).danceOrder
            : undefined,
        ),
      }),
    },
  ),
);
