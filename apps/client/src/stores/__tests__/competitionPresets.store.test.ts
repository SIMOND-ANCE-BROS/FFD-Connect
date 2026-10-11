import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  COMPETITION_PRESETS_STORAGE_KEY,
  MAX_PRESETS,
  PRESET_NAME_MAX_LENGTH,
  findPresetByName,
  resolvePresets,
  useCompetitionPresetsStore,
  type SaveResult,
} from "../competitionPresets.store";
import {
  createDefaultConfig,
  type PerformanceConfig,
} from "../performance.store";

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
  AsyncStorage.setItem(
    COMPETITION_PRESETS_STORAGE_KEY,
    JSON.stringify({ state, version: 1 }),
  );

describe("competitionPresets.store", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useCompetitionPresetsStore.setState({ presets: [], activePresetId: null });
  });

  it("saves the programme under a trimmed name, newest first, and makes it active", () => {
    const a = store().save("  Gala  ", config(60));
    const b = store().save("Entraînement", config(90));
    expect(a).toEqual({ ok: true, id: expect.any(String) });
    expect(store().presets.map((p) => p.name)).toEqual([
      "Entraînement",
      "Gala",
    ]);
    expect(store().presets[1].config.duration).toBe(60);
    expect(store().activePresetId).toBe(idOf(b));
    expect(Number.isNaN(Date.parse(store().presets[0].updatedAt))).toBe(false);
  });

  it("refuses an empty name", () => {
    expect(store().save("   ", config())).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(store().presets).toHaveLength(0);
  });

  it("caps the name length", () => {
    store().save("x".repeat(PRESET_NAME_MAX_LENGTH + 10), config());
    expect(store().presets[0].name).toHaveLength(PRESET_NAME_MAX_LENGTH);
  });

  it("reports a duplicate name, case- and space-insensitively", () => {
    store().save("Gala", config());
    expect(store().save(" gala  ", config(30))).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(findPresetByName(store().presets, "GALA")?.config.duration).toBe(90);
    expect(store().presets).toHaveLength(1);
  });

  it("refuses a new name when full, but still reports a duplicate first", () => {
    for (let i = 0; i < MAX_PRESETS; i++) store().save(`P${i}`, config());
    expect(store().save("Nouveau", config())).toEqual({
      ok: false,
      reason: "full",
    });
    expect(store().save("p3", config())).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(store().presets).toHaveLength(MAX_PRESETS);
  });

  it("stores a deep copy of the programme", () => {
    const live = config();
    store().save("Gala", live);
    live.rounds[0].groups.push("Standard");
    live.rounds[0].dances.Latin.pop();
    live.duration = 10;
    const stored = store().presets[0].config;
    expect(stored.rounds[0].groups).toEqual(["Latin", "Latin"]);
    expect(stored.rounds[0].dances.Latin).toHaveLength(5);
    expect(stored.duration).toBe(90);
  });

  it("overwrites a preset's programme, moves it first and makes it active", () => {
    const gala = idOf(store().save("Gala", config(60)));
    store().save("Autre", config());
    store().setActive(null);

    const live = config(45);
    store().overwrite(gala, live);
    live.rounds[0].groups.pop();

    expect(store().presets[0]).toMatchObject({ id: gala, name: "Gala" });
    expect(store().presets[0].config.duration).toBe(45);
    expect(store().presets[0].config.rounds[0].groups).toHaveLength(2);
    expect(store().activePresetId).toBe(gala);
    expect(store().presets).toHaveLength(2);
  });

  it("ignores an overwrite of an unknown preset", () => {
    store().save("Gala", config(60));
    store().overwrite("nope", config(45));
    expect(store().presets).toHaveLength(1);
    expect(store().presets[0].config.duration).toBe(60);
  });

  it("renames a preset, refusing an empty name or another preset's name", () => {
    store().save("Autre", config());
    const gala = idOf(store().save("Gala", config()));
    const before = store().presets.map((p) => p.id);

    expect(store().rename(gala, "  ")).toEqual({ ok: false, reason: "empty" });
    expect(store().rename(gala, "autre")).toEqual({
      ok: false,
      reason: "duplicate",
    });
    // Its own name with another case is not a duplicate.
    expect(store().rename(gala, "GALA")).toEqual({ ok: true, id: gala });
    expect(store().rename(gala, "  Championnat ")).toEqual({
      ok: true,
      id: gala,
    });
    expect(findPresetByName(store().presets, "championnat")?.id).toBe(gala);
    // Renaming does not reorder the list.
    expect(store().presets.map((p) => p.id)).toEqual(before);
  });

  it("removes a preset and clears it when it was the active one", () => {
    const a = idOf(store().save("A", config()));
    const b = idOf(store().save("B", config()));
    store().remove(a);
    expect(store().activePresetId).toBe(b);
    store().remove(b);
    expect(store().activePresetId).toBeNull();
    expect(store().presets).toEqual([]);
  });

  it("only activates a preset that exists", () => {
    const a = idOf(store().save("A", config()));
    store().setActive("nope");
    expect(store().activePresetId).toBeNull();
    store().setActive(a);
    expect(store().activePresetId).toBe(a);
  });

  it("persists only the presets on the device", async () => {
    store().save("Gala", config());
    await Promise.resolve();
    const entry = await saved();
    expect(entry?.version).toBe(1);
    expect(entry?.state).toEqual({ presets: store().presets });
  });

  it("restores the presets of the previous session, with no active one", async () => {
    const stored = config(60);
    const preset = {
      id: "p1",
      name: "Gala",
      updatedAt: "2026-10-11T10:00:00.000Z",
      config: stored,
    };
    await writeStorage({ presets: [preset], activePresetId: "p1" });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().presets).toEqual([preset]);
    expect(store().activePresetId).toBeNull();
  });

  it("keeps the session's active preset only if it still exists after rehydration", async () => {
    const stored = config();
    // setState persists too: set it first so it cannot overwrite the entry below.
    useCompetitionPresetsStore.setState({ activePresetId: "p1" });
    await writeStorage({
      presets: [{ id: "p1", name: "A", updatedAt: "", config: stored }],
    });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().activePresetId).toBe("p1");

    await writeStorage({ presets: [] });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().activePresetId).toBeNull();
  });

  it("drops corrupted entries from storage", async () => {
    const valid = config();
    await writeStorage({
      presets: [
        null,
        "x",
        { id: "", name: "A", config: valid },
        { id: "p1", name: "   ", config: valid },
        { id: "p2", name: "B", config: { rounds: "no" } },
        { id: "p3", name: " C ", updatedAt: "garbage", config: valid },
        { id: "p3", name: "D", config: valid },
      ],
    });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().presets).toEqual([
      {
        id: "p3",
        name: "C",
        updatedAt: new Date(0).toISOString(),
        config: valid,
      },
    ]);
  });

  it("falls back to an empty list on unusable storage", async () => {
    await writeStorage({ presets: "oops" });
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().presets).toEqual([]);
    await writeStorage("oops");
    await useCompetitionPresetsStore.persist.rehydrate();
    expect(store().presets).toEqual([]);
  });
});

describe("resolvePresets", () => {
  it("keeps at most MAX_PRESETS entries, in stored order", () => {
    const valid = config();
    const many = Array.from({ length: MAX_PRESETS + 5 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      updatedAt: "2026-10-11T10:00:00.000Z",
      config: valid,
    }));
    const kept = resolvePresets(many);
    expect(kept).toHaveLength(MAX_PRESETS);
    expect(kept[0].id).toBe("p0");
  });
});
