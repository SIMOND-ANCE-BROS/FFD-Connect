import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { PINNED_HEADER_BAR, PinnedHeader } from "../PinnedHeader";

jest.mock("@react-native-masked-view/masked-view", () => {
  const { View } = jest.requireActual("react-native");
  return { __esModule: true, default: View };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

// `AppText`, rendu par la barre de titre, lit le thème par contexte.
jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666", border: "#ccc" },
    isDark: false,
  }),
}));

const theme = { text: "#000", border: "#ccc" } as never;

/** Le flou déborde de 28 px sous le contenu (`FADE_TAIL`, privé au composant). */
const FADE_TAIL = 28;

const renderHeader = (onHeightChange?: (h: number) => void) =>
  render(
    <PinnedHeader
      theme={theme}
      isDark={false}
      title="Notifications"
      onHeightChange={onHeightChange}
    >
      <Text>Filtres</Text>
    </PinnedHeader>,
  );

describe("PinnedHeader", () => {
  it("affiche le titre et le contenu épinglé", async () => {
    const { getByText } = await renderHeader();

    expect(getByText("Notifications")).toBeTruthy();
    expect(getByText("Filtres")).toBeTruthy();
  });

  /**
   * Le cœur du correctif : les écrans calent leur liste sur cette valeur, donc
   * elle doit décrire ce qui est VISIBLE — fondu compris — et pas la boîte du
   * contenu. Avant, la liste commençait 28 px trop haut, soit à l'intérieur du
   * fondu : le premier élément passait sous l'en-tête.
   */
  it("remonte la hauteur du contenu PLUS le fondu qui déborde dessous", async () => {
    const onHeightChange = jest.fn();
    const { getByTestId } = await renderHeader(onHeightChange);

    await fireEvent(getByTestId("pinned-header-content"), "layout", {
      nativeEvent: { layout: { height: 120 } },
    });

    expect(onHeightChange).toHaveBeenCalledWith(120 + FADE_TAIL);
  });

  // `onHeightChange` est optionnel : plusieurs écrans montent l'en-tête sans
  // s'en servir, et la mesure ne doit pas les faire tomber.
  it("survit à une mesure quand l'écran ne s'intéresse pas à la hauteur", async () => {
    const { getByTestId, getByText } = await renderHeader();

    await fireEvent(getByTestId("pinned-header-content"), "layout", {
      nativeEvent: { layout: { height: 90 } },
    });

    expect(getByText("Notifications")).toBeTruthy();
  });

  it("publie la hauteur de barre que les écrans utilisent comme estimation", () => {
    expect(PINNED_HEADER_BAR).toBe(56);
  });
});
