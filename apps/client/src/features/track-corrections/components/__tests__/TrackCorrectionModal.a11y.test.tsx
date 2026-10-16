import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { TrackCorrectionModal } from "../TrackCorrectionModal";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// Screen-reader contract of the correction modal (RGAA, issue #22).

jest.mock("../../../../services/api/track-correction-api", () => {
  const actual = jest.requireActual<
    typeof import("../../../../services/api/track-correction-api")
  >("../../../../services/api/track-correction-api");
  return { ...actual, TrackCorrectionApi: { create: jest.fn() } };
});

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      border: "#ddd",
      primary: "#00f",
    },
    isDark: false,
  }),
}));

preloadReactNative("Modal", "Animated", "TextInput");

const track = {
  id: "track-1",
  title: "My Song",
  artist: "Old Artist",
  style: "Rumba",
  bpm: 25,
};

const renderModal = (onClose = jest.fn()) => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TrackCorrectionModal visible onClose={onClose} track={track} />
    </QueryClientProvider>,
  );
};

describe("TrackCorrectionModal accessibility", () => {
  it("exposes the title and the question as headings", async () => {
    const { getByRole } = await renderModal();
    expect(
      getByRole("header", { name: "Proposer une correction" }),
    ).toBeTruthy();
    expect(
      getByRole("header", { name: "Qu'est-ce qui est incorrect ?" }),
    ).toBeTruthy();
  });

  it("reports the selected reason and the submit state", async () => {
    const { getByRole, getByTestId } = await renderModal();
    expect(
      getByRole("button", { name: "Envoyer la proposition" }).props
        .accessibilityState,
    ).toMatchObject({ disabled: true });

    await fireEvent.press(getByTestId("correction-reason-MPM"));
    expect(
      getByTestId("correction-reason-MPM").props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(
      getByRole("button", { name: "Envoyer la proposition" }).props
        .accessibilityState,
    ).toMatchObject({ disabled: false });
  });

  it("names the MPM field once and gives the current value in the hint", async () => {
    const { getByLabelText, getByTestId, queryByText } = await renderModal();
    await fireEvent.press(getByTestId("correction-reason-MPM"));
    const input = getByLabelText("MPM correct");
    expect(input.props.testID).toBe("correction-mpm-input");
    expect(input.props.accessibilityHint).toContain("Valeur actuelle : 25");
    // The visual caption is not read a second time.
    expect(queryByText("MPM correct (mesures par minute)")).toBeNull();
  });

  it("says when the comment is required", async () => {
    const { getByLabelText, getByTestId } = await renderModal();
    await fireEvent.press(getByTestId("correction-reason-DELETE"));
    expect(
      getByLabelText("Commentaire pour les administrateurs").props
        .accessibilityHint,
    ).toMatch(/^Obligatoire\./);
  });

  it("closes from the « Fermer » button", async () => {
    const onClose = jest.fn();
    const { getByLabelText } = await renderModal(onClose);
    await fireEvent.press(getByLabelText("Fermer", { exact: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
