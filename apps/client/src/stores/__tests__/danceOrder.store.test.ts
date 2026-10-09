import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DANCE_ORDER_STORAGE_KEY,
  isOfficialOrder,
  OFFICIAL_DANCE_ORDER,
  resolveCategoryOrder,
  resolveDanceOrder,
  useDanceOrderStore,
} from "../danceOrder.store";
import { DANCES } from "../performance.store";

const CUSTOM_LATIN = ["Cha-Cha-Cha", "Samba", "Rumba", "Paso Doble", "Jive"];

/** Last value written to the device storage, parsed. */
const saved = async () => {
  const raw = await AsyncStorage.getItem(DANCE_ORDER_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { state: unknown; version: number }) : null;
};

describe("danceOrder.store", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useDanceOrderStore.setState({ danceOrder: OFFICIAL_DANCE_ORDER });
  });

  it("defaults to the official order when nothing is saved", () => {
    expect(useDanceOrderStore.getState().danceOrder).toEqual({
      Standard: [...DANCES.Standard],
      Latin: [...DANCES.Latin],
    });
    expect(isOfficialOrder(useDanceOrderStore.getState().danceOrder)).toBe(
      true,
    );
  });

  it("changes one category without touching the other", () => {
    useDanceOrderStore.getState().setCategoryOrder("Latin", CUSTOM_LATIN);
    const { danceOrder } = useDanceOrderStore.getState();
    expect(danceOrder.Latin).toEqual(CUSTOM_LATIN);
    expect(danceOrder.Standard).toEqual([...DANCES.Standard]);
    expect(isOfficialOrder(danceOrder)).toBe(false);
    expect(isOfficialOrder(danceOrder, "Standard")).toBe(true);
    expect(isOfficialOrder(danceOrder, "Latin")).toBe(false);
  });

  it("sanitizes the order it is given (unknown, duplicated, missing)", () => {
    useDanceOrderStore
      .getState()
      .setCategoryOrder("Latin", ["Jive", "Tango", "Jive", "Rumba"]);
    expect(useDanceOrderStore.getState().danceOrder.Latin).toEqual([
      "Jive",
      "Rumba",
      "Samba",
      "Cha-Cha-Cha",
      "Paso Doble",
    ]);
  });

  it("resets one category, or both", () => {
    const s = useDanceOrderStore.getState();
    s.setCategoryOrder("Latin", CUSTOM_LATIN);
    s.setCategoryOrder("Standard", ["Tango", "Valse Lente"]);
    s.resetDanceOrder("Latin");
    expect(useDanceOrderStore.getState().danceOrder.Latin).toEqual([
      ...DANCES.Latin,
    ]);
    expect(useDanceOrderStore.getState().danceOrder.Standard[0]).toBe("Tango");
    useDanceOrderStore.getState().resetDanceOrder();
    expect(isOfficialOrder(useDanceOrderStore.getState().danceOrder)).toBe(
      true,
    );
  });

  it("persists only the order on the device", async () => {
    useDanceOrderStore.getState().setCategoryOrder("Latin", CUSTOM_LATIN);
    await Promise.resolve();
    const entry = await saved();
    expect(entry?.version).toBe(1);
    expect(entry?.state).toEqual({
      danceOrder: { Standard: [...DANCES.Standard], Latin: CUSTOM_LATIN },
    });
  });

  it("restores the saved order as the default of the next session", async () => {
    await AsyncStorage.setItem(
      DANCE_ORDER_STORAGE_KEY,
      JSON.stringify({
        state: { danceOrder: { Latin: CUSTOM_LATIN } },
        version: 1,
      }),
    );
    await useDanceOrderStore.persist.rehydrate();
    expect(useDanceOrderStore.getState().danceOrder).toEqual({
      Standard: [...DANCES.Standard],
      Latin: CUSTOM_LATIN,
    });
  });

  it("falls back to the official order on corrupted storage", async () => {
    await AsyncStorage.setItem(
      DANCE_ORDER_STORAGE_KEY,
      JSON.stringify({ state: { danceOrder: "oops" }, version: 1 }),
    );
    await useDanceOrderStore.persist.rehydrate();
    expect(isOfficialOrder(useDanceOrderStore.getState().danceOrder)).toBe(
      true,
    );
  });
});

describe("resolveDanceOrder / resolveCategoryOrder", () => {
  it("returns the official order for anything unusable", () => {
    expect(resolveDanceOrder(undefined)).toEqual(OFFICIAL_DANCE_ORDER);
    expect(resolveDanceOrder(null)).toEqual(OFFICIAL_DANCE_ORDER);
    expect(resolveDanceOrder({ Latin: 42, Standard: [1, 2] })).toEqual(
      OFFICIAL_DANCE_ORDER,
    );
  });

  it("appends dances missing from a stale order, in official order", () => {
    expect(resolveCategoryOrder("Standard", ["Quickstep"])).toEqual([
      "Quickstep",
      "Valse Lente",
      "Tango",
      "Valse Viennoise",
      "Slow Fox",
    ]);
  });
});
