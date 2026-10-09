import { useNavigation } from "@react-navigation/native";
import { fireEvent, render } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { useTheme } from "../../../../context/ThemeContext";
import {
  OFFICIAL_DANCE_ORDER,
  useDanceOrderStore,
} from "../../../../stores/danceOrder.store";
import {
  createRound,
  usePerformanceStore,
  type PerformanceConfig,
  type RoundConfig,
} from "../../../../stores/performance.store";
import { usePerformanceEngine } from "../../hooks/usePerformanceEngine";
import { PerformanceSetupScreen } from "../PerformanceSetupScreen";

jest.mock("../../hooks/usePerformanceEngine", () => ({
  usePerformanceEngine: jest.fn(),
}));
jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: jest.fn(),
}));

type Updater = (prev: PerformanceConfig) => PerformanceConfig;

describe("PerformanceSetupScreen", () => {
  const mockTheme = {
    background: "#fff",
    surface: "#f2f2f2",
    text: "#111",
    textSecondary: "#666",
    primary: "#3b82f6",
    border: "#e5e7eb",
  };

  const navigation = {
    goBack: jest.fn(),
    navigate: jest.fn(),
    isFocused: jest.fn(() => true),
  };

  const latin: RoundConfig = { ...createRound("Latin", "Round"), id: "r1" };
  const standard: RoundConfig = {
    ...createRound("Standard", "Round"),
    id: "r2",
  };
  const baseConfig: PerformanceConfig = {
    rounds: [latin],
    duration: 30,
    pauseDuration: 10,
    pasoClashes: 2,
  };

  const mockEngine = (
    overrides: Partial<ReturnType<typeof usePerformanceEngine>> = {},
  ) => {
    const value = {
      config: baseConfig,
      setConfig: jest.fn(),
      startPerformance: jest.fn(),
      stopPerformance: jest.fn(),
      status: "idle",
      loadingProgress: null,
      ...overrides,
    };
    (usePerformanceEngine as jest.Mock).mockReturnValue(value);
    return value;
  };

  /** Applies the updater passed to setConfig to a config. */
  const applyLast = (
    setConfig: jest.Mock,
    config: PerformanceConfig = baseConfig,
  ): PerformanceConfig => {
    const arg = setConfig.mock.calls[setConfig.mock.calls.length - 1][0] as
      | Updater
      | PerformanceConfig;
    return typeof arg === "function" ? arg(config) : arg;
  };

  /** Engine start that leaves the (real) store in the given status. */
  const startTo =
    (status: "break" | "idle", result = true) =>
    () => {
      usePerformanceStore.getState().setStatus(status);
      return Promise.resolve(result);
    };

  beforeEach(() => {
    jest.clearAllMocks();
    usePerformanceStore.getState().setStatus("idle");
    useDanceOrderStore.setState({ danceOrder: OFFICIAL_DANCE_ORDER });
    (useTheme as jest.Mock).mockReturnValue({ theme: mockTheme });
    (useNavigation as jest.Mock).mockReturnValue(navigation);
    mockEngine();
  });

  it("renders one card per round", async () => {
    mockEngine({ config: { ...baseConfig, rounds: [latin, standard] } });
    const { getByTestId, getByText } = await render(<PerformanceSetupScreen />);
    expect(getByTestId("performance-round-0-card")).toBeTruthy();
    expect(getByTestId("performance-round-1-card")).toBeTruthy();
    expect(getByText("Tour 2")).toBeTruthy();
    expect(
      getByTestId("performance-round-1-dance-valse-viennoise"),
    ).toHaveTextContent("Valse viennoise");
  });

  it("adds a round copying the previous round's groups", async () => {
    const { setConfig } = mockEngine();
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId("performance-add-round-button"));
    const next = applyLast(setConfig);
    expect(next.rounds).toHaveLength(2);
    expect(next.rounds[1]).toMatchObject({
      type: "Round",
      groups: ["Latin", "Latin"],
    });
  });

  it("only allows deleting when several rounds exist", async () => {
    const { queryByTestId, rerender } = await render(
      <PerformanceSetupScreen />,
    );
    expect(queryByTestId("performance-round-0-delete-button")).toBeNull();

    const { setConfig } = mockEngine({
      config: { ...baseConfig, rounds: [latin, standard] },
    });
    await rerender(<PerformanceSetupScreen />);
    await fireEvent.press(
      queryByTestId("performance-round-1-delete-button") as never,
    );
    const next = applyLast(setConfig, {
      ...baseConfig,
      rounds: [latin, standard],
    });
    expect(next.rounds.map((r) => r.id)).toEqual(["r1"]);
  });

  it("lists the groups and sets the category of each", async () => {
    const { setConfig } = mockEngine();
    const { getByTestId, getByText } = await render(<PerformanceSetupScreen />);
    expect(getByText("Groupe 1")).toBeTruthy();
    expect(getByText("Groupe 2")).toBeTruthy();
    await fireEvent.press(getByTestId("performance-round-0-group-1-standard"));
    expect(applyLast(setConfig).rounds[0].groups).toEqual([
      "Latin",
      "Standard",
    ]);
  });

  it("adds and removes groups, never below one", async () => {
    const { setConfig } = mockEngine();
    const { getByTestId, queryByTestId, rerender } = await render(
      <PerformanceSetupScreen />,
    );
    await fireEvent.press(getByTestId("performance-round-0-add-group"));
    expect(applyLast(setConfig).rounds[0].groups).toHaveLength(3);
    await fireEvent.press(getByTestId("performance-round-0-group-0-remove"));
    const one = applyLast(setConfig);
    expect(one.rounds[0].groups).toEqual(["Latin"]);

    mockEngine({ config: one, setConfig });
    await rerender(<PerformanceSetupScreen />);
    expect(queryByTestId("performance-round-0-group-0-remove")).toBeNull();
  });

  it("shows the dances of each category danced, and the floor order", async () => {
    const mixed: RoundConfig = {
      ...latin,
      groups: ["Standard", "Latin", "Standard"],
      dances: { Standard: ["Valse Lente", "Tango"], Latin: ["Samba"] },
    };
    mockEngine({ config: { ...baseConfig, rounds: [mixed] } });
    const { getByText, getByTestId } = await render(<PerformanceSetupScreen />);
    expect(getByText("Danses Standard")).toBeTruthy();
    expect(getByText("Danses Latines")).toBeTruthy();
    expect(getByTestId("performance-round-0-preview")).toHaveTextContent(
      "Déroulé : Valse lente (G1) → Samba (G2) → Valse lente (G3) → Tango (G1) → Tango (G3)",
    );
  });

  it("previews a multi-group Final group by group", async () => {
    const final: RoundConfig = {
      ...latin,
      type: "Final",
      groups: ["Standard", "Latin", "Standard"],
      dances: { Standard: ["Valse Lente", "Tango"], Latin: ["Samba"] },
    };
    mockEngine({ config: { ...baseConfig, rounds: [final] } });
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    expect(getByTestId("performance-round-0-preview")).toHaveTextContent(
      "Déroulé : Valse lente (G1) → Tango (G1) → Samba (G2) → Valse lente (G3) → Tango (G3)",
    );
  });

  it("hides the dances of a category no group dances", async () => {
    mockEngine();
    const { queryByText } = await render(<PerformanceSetupScreen />);
    expect(queryByText("Danses Standard")).toBeNull();
  });

  it("switches a round to Final", async () => {
    const { setConfig } = mockEngine();
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId("performance-round-0-type-tab-Final"));
    expect(applyLast(setConfig).rounds[0].type).toBe("Final");
  });

  it("toggles a dance of a round", async () => {
    const { setConfig } = mockEngine();
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId("performance-round-0-dance-samba"));
    expect(applyLast(setConfig).rounds[0].dances.Latin).not.toContain("Samba");
  });

  it("shows the Paso setting only when a Latin round contains the Paso", async () => {
    const { setConfig } = mockEngine();
    const { getByTestId, queryByTestId, rerender } = await render(
      <PerformanceSetupScreen />,
    );
    await fireEvent.press(getByTestId("performance-setup-paso-tab-3"));
    expect(applyLast(setConfig).pasoClashes).toBe(3);

    mockEngine({ config: { ...baseConfig, rounds: [standard] } });
    await rerender(<PerformanceSetupScreen />);
    expect(queryByTestId("performance-setup-paso-tab")).toBeNull();
  });

  it("updates numeric inputs", async () => {
    const { setConfig } = mockEngine();
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.changeText(
      getByTestId("performance-setup-duration-input"),
      "45",
    );
    expect(applyLast(setConfig).duration).toBe(45);
    await fireEvent.changeText(
      getByTestId("performance-setup-pause-duration-input"),
      "20",
    );
    expect(applyLast(setConfig).pauseDuration).toBe(20);
  });

  it("shows download progress and disables start while loading", async () => {
    const { startPerformance } = mockEngine({
      status: "loading",
      loadingProgress: { done: 3, total: 12 },
    });
    const { getByText, getByTestId } = await render(<PerformanceSetupScreen />);
    expect(getByText("CHARGEMENT… 3/12")).toBeTruthy();
    expect(getByTestId("performance-setup-loading-hint")).toBeTruthy();
    await fireEvent.press(getByTestId("performance-setup-start-button"));
    expect(startPerformance).not.toHaveBeenCalled();
  });

  it("starts performance and navigates", async () => {
    const { startPerformance } = mockEngine({
      startPerformance: jest.fn(startTo("break")),
    });
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId("performance-setup-start-button"));
    expect(startPerformance).toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith("PerformancePlayer");
  });

  it("offers « Annuler » while loading, which stops the engine", async () => {
    const { stopPerformance } = mockEngine({
      status: "loading",
      loadingProgress: { done: 1, total: 5 },
    });
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId("performance-setup-cancel-button"));
    expect(stopPerformance).toHaveBeenCalled();
  });

  it("does not navigate when the loading was cancelled meanwhile", async () => {
    // start resolves but the session was cancelled → store is idle
    mockEngine({ startPerformance: jest.fn(startTo("idle")) });
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId("performance-setup-start-button"));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("stops instead of navigating when the user left the screen", async () => {
    navigation.isFocused.mockReturnValueOnce(false);
    const { stopPerformance } = mockEngine({
      startPerformance: jest.fn(startTo("break")),
    });
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId("performance-setup-start-button"));
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(stopPerformance).toHaveBeenCalled();
  });

  it("stops the loading when the setup screen unmounts", async () => {
    const { stopPerformance } = mockEngine({ status: "loading" });
    usePerformanceStore.getState().setStatus("loading");
    const { unmount } = await render(<PerformanceSetupScreen />);
    await unmount();
    expect(stopPerformance).toHaveBeenCalled();
  });

  it("does not stop a running competition on unmount", async () => {
    const { stopPerformance } = mockEngine();
    usePerformanceStore.getState().setStatus("break");
    const { unmount } = await render(<PerformanceSetupScreen />);
    await unmount();
    expect(stopPerformance).not.toHaveBeenCalled();
  });

  it("stays on setup when the engine refuses to start", async () => {
    mockEngine({ startPerformance: jest.fn().mockResolvedValue(false) });
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId("performance-setup-start-button"));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("navigates back", async () => {
    const { getByTestId } = await render(<PerformanceSetupScreen />);
    await fireEvent.press(getByTestId("back-button"));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  describe("dance order", () => {
    const latinOrder = () => useDanceOrderStore.getState().danceOrder.Latin;

    it("only lists the categories danced in the programme", async () => {
      const { getByTestId, queryByTestId } = await render(
        <PerformanceSetupScreen />,
      );
      expect(getByTestId("performance-dance-order-latin")).toBeTruthy();
      expect(queryByTestId("performance-dance-order-standard")).toBeNull();
    });

    it("moves a dance with the arrows and the floor order follows", async () => {
      const { getByTestId } = await render(<PerformanceSetupScreen />);
      await fireEvent.press(
        getByTestId("performance-dance-order-latin-cha-cha-cha-up"),
      );
      expect(latinOrder()).toEqual([
        "Cha-Cha-Cha",
        "Samba",
        "Rumba",
        "Paso Doble",
        "Jive",
      ]);
      expect(getByTestId("performance-round-0-preview")).toHaveTextContent(
        /^Déroulé : Cha-cha-cha \(G1\) → Cha-cha-cha \(G2\) → Samba \(G1\)/,
      );
      // First / last positions cannot move further.
      expect(
        getByTestId("performance-dance-order-latin-cha-cha-cha-up"),
      ).toBeDisabled();
      expect(
        getByTestId("performance-dance-order-latin-jive-down"),
      ).toBeDisabled();
    });

    it("resets to the official order", async () => {
      useDanceOrderStore
        .getState()
        .setCategoryOrder("Latin", ["Jive", "Rumba", "Samba"]);
      const { getByTestId } = await render(<PerformanceSetupScreen />);
      const reset = getByTestId("performance-dance-order-reset");
      expect(reset).not.toBeDisabled();

      await fireEvent.press(reset);

      expect(latinOrder()).toEqual([
        "Samba",
        "Cha-Cha-Cha",
        "Rumba",
        "Paso Doble",
        "Jive",
      ]);
      expect(getByTestId("performance-dance-order-reset")).toBeDisabled();
    });

    it("disables the reset while the order is already official", async () => {
      const { getByTestId } = await render(<PerformanceSetupScreen />);
      expect(getByTestId("performance-dance-order-reset")).toBeDisabled();
    });
  });
});
