import { act, renderHook } from "@testing-library/react-native";
import { Alert } from "react-native";
import { useLayoutEditor } from "../useLayoutEditor";
import type { LayoutItem } from "../useClubCompetitionEditorLogic.types";

const table: LayoutItem = {
  id: "t1",
  type: "TABLE",
  label: "Table 1",
  capacity: 8,
  x: 10,
  y: 10,
  width: 12,
  height: 10,
  priceCents: 1550,
};

describe("useLayoutEditor — seat price (#405)", () => {
  beforeEach(() => {
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("stores the typed price in cents on a new table", async () => {
    const { result } = await renderHook(() => useLayoutEditor({}));
    await act(async () => {
      result.current.openLayoutModal(undefined, "TABLE");
    });
    await act(async () => {
      result.current.setNewLayoutLabel("Table VIP");
      result.current.setNewLayoutPrice("25");
    });
    await act(async () => {
      result.current.addLayoutItem();
    });
    expect(result.current.layoutItems[0]?.priceCents).toBe(2500);
  });

  it("keeps a new element without price when the field is empty", async () => {
    const { result } = await renderHook(() => useLayoutEditor({}));
    await act(async () => {
      result.current.openLayoutModal(undefined, "GRADIN");
    });
    await act(async () => {
      result.current.setNewLayoutLabel("Gradin Nord");
    });
    await act(async () => {
      result.current.addLayoutItem();
    });
    expect(result.current.layoutItems[0]).not.toHaveProperty("priceCents");
  });

  it("prefills, edits and clears the price of an existing element", async () => {
    const { result } = await renderHook(() =>
      useLayoutEditor({ initialLayoutItems: [table] }),
    );
    await act(async () => {
      result.current.openLayoutModal(table);
    });
    expect(result.current.newLayoutPrice).toBe("15,50");
    await act(async () => {
      result.current.setNewLayoutPrice("");
    });
    await act(async () => {
      result.current.addLayoutItem();
    });
    expect(result.current.layoutItems[0]?.priceCents).toBeUndefined();
  });

  it("refuses an invalid price without saving", async () => {
    const { result } = await renderHook(() =>
      useLayoutEditor({ initialLayoutItems: [table] }),
    );
    await act(async () => {
      result.current.openLayoutModal(table);
    });
    await act(async () => {
      result.current.setNewLayoutPrice("abc");
    });
    await act(async () => {
      result.current.addLayoutItem();
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Tarif invalide",
      expect.any(String),
    );
    expect(result.current.layoutItems[0]?.priceCents).toBe(1550);
    expect(result.current.showLayoutModal).toBe(true);
  });

  it("never prices a non-bookable element", async () => {
    const { result } = await renderHook(() => useLayoutEditor({}));
    await act(async () => {
      result.current.openLayoutModal(undefined, "OTHER");
    });
    await act(async () => {
      result.current.setNewLayoutLabel("Buvette");
      result.current.setNewLayoutPrice("5");
    });
    await act(async () => {
      result.current.addLayoutItem();
    });
    expect(result.current.layoutItems[0]).not.toHaveProperty("priceCents");
  });
});
