import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import {
  TrackCorrectionApi,
  TrackCorrectionApiError,
} from "../../../../services/api/track-correction-api";
import { TrackCorrectionModal } from "../TrackCorrectionModal";

jest.mock("../../../../services/api/track-correction-api", () => {
  const actual = jest.requireActual<
    typeof import("../../../../services/api/track-correction-api")
  >("../../../../services/api/track-correction-api");
  return {
    ...actual,
    TrackCorrectionApi: { create: jest.fn() },
  };
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

const createMock = TrackCorrectionApi.create as jest.Mock;

const track = {
  id: "track-1",
  title: "My Song",
  artist: "Old Artist",
  style: "Rumba",
  bpm: 25,
};

const renderModal = (
  props: Partial<React.ComponentProps<typeof TrackCorrectionModal>> = {},
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TrackCorrectionModal
        visible
        onClose={jest.fn()}
        track={track}
        {...props}
      />
    </QueryClientProvider>,
  );
};

describe("TrackCorrectionModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createMock.mockResolvedValue({ id: "c1" });
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  });

  it("affiche la piste et tous les motifs", async () => {
    const { getByText, getByTestId } = await renderModal();
    expect(getByText("My Song")).toBeTruthy();
    for (const reason of [
      "TITLE",
      "ARTIST",
      "DANCE",
      "MPM",
      "PASO_CLASH",
      "OTHER",
    ]) {
      expect(getByTestId(`correction-reason-${reason}`)).toBeTruthy();
    }
  });

  it("n'envoie rien tant qu'aucun motif n'est choisi", async () => {
    const { getByTestId } = await renderModal();
    await fireEvent.press(getByTestId("correction-submit-button"));
    expect(createMock).not.toHaveBeenCalled();
  });

  it("pré-remplit le titre et envoie la valeur corrigée", async () => {
    const onClose = jest.fn();
    const { getByTestId } = await renderModal({ onClose });

    await fireEvent.press(getByTestId("correction-reason-TITLE"));
    expect(getByTestId("correction-title-input").props.value).toBe("My Song");
    await fireEvent.changeText(
      getByTestId("correction-title-input"),
      "  The Real Song ",
    );
    await fireEvent.press(getByTestId("correction-submit-button"));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        trackId: "track-1",
        reason: "TITLE",
        title: "The Real Song",
      }),
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      "Merci !",
      "Proposition envoyée aux administrateurs.",
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("propose un artiste corrigé avec un commentaire", async () => {
    const { getByTestId } = await renderModal();
    await fireEvent.press(getByTestId("correction-reason-ARTIST"));
    expect(getByTestId("correction-artist-input").props.value).toBe(
      "Old Artist",
    );
    await fireEvent.changeText(
      getByTestId("correction-artist-input"),
      "New Artist",
    );
    await fireEvent.changeText(
      getByTestId("correction-message-input"),
      " vu sur la pochette ",
    );
    await fireEvent.press(getByTestId("correction-submit-button"));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        trackId: "track-1",
        reason: "ARTIST",
        artist: "New Artist",
        message: "vu sur la pochette",
      }),
    );
  });

  it("propose une autre danse via le même sélecteur que l'admin", async () => {
    const { getByTestId } = await renderModal();
    await fireEvent.press(getByTestId("correction-reason-DANCE"));
    await fireEvent.press(getByTestId("correction-dance-Cha-cha"));
    await fireEvent.press(getByTestId("correction-submit-button"));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        trackId: "track-1",
        reason: "DANCE",
        style: "Cha-cha",
      }),
    );
  });

  it("propose un MPM numérique", async () => {
    const { getByTestId, getByText } = await renderModal();
    await fireEvent.press(getByTestId("correction-reason-MPM"));
    expect(getByText("Valeur actuelle : 25 MPM")).toBeTruthy();
    await fireEvent.changeText(getByTestId("correction-mpm-input"), "27");
    await fireEvent.press(getByTestId("correction-submit-button"));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        trackId: "track-1",
        reason: "MPM",
        bpm: 27,
      }),
    );
  });

  it("arrondit le MPM pré-rempli et n'envoie pas une valeur inchangée", async () => {
    const { getByTestId, getByText } = await renderModal({
      track: { ...track, bpm: 25.4 },
    });
    await fireEvent.press(getByTestId("correction-reason-MPM"));
    expect(getByTestId("correction-mpm-input").props.value).toBe("25");
    expect(getByText("Valeur actuelle : 25 MPM")).toBeTruthy();
    await fireEvent.press(getByTestId("correction-submit-button"));

    expect(createMock).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Proposition incomplète",
      "Modifiez la valeur proposée ou ajoutez un commentaire.",
    );
  });

  it("compare la danse sans tenir compte de la casse, comme le backend", async () => {
    const { getByTestId } = await renderModal({
      track: { ...track, style: "rumba" },
    });
    await fireEvent.press(getByTestId("correction-reason-DANCE"));
    // « rumba » est reconnue comme la puce « Rumba » déjà sélectionnée.
    expect(
      getByTestId("correction-dance-Rumba").props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
    await fireEvent.press(getByTestId("correction-dance-Rumba"));
    await fireEvent.press(getByTestId("correction-submit-button"));

    expect(createMock).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Proposition incomplète",
      "Modifiez la valeur proposée ou ajoutez un commentaire.",
    );
  });

  it("refuse un MPM invalide sans appeler l'API", async () => {
    const { getByTestId } = await renderModal();
    await fireEvent.press(getByTestId("correction-reason-MPM"));
    await fireEvent.changeText(getByTestId("correction-mpm-input"), "999");
    await fireEvent.press(getByTestId("correction-submit-button"));

    expect(createMock).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Proposition incomplète",
      expect.stringContaining("entre 1 et 400"),
    );
  });

  it("refuse une valeur inchangée sans commentaire", async () => {
    const { getByTestId } = await renderModal();
    await fireEvent.press(getByTestId("correction-reason-TITLE"));
    await fireEvent.press(getByTestId("correction-submit-button"));

    expect(createMock).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Proposition incomplète",
      "Modifiez la valeur proposée ou ajoutez un commentaire.",
    );
  });

  it("« Autre » s'envoie avec la seule description", async () => {
    const { getByTestId, getByText } = await renderModal();
    await fireEvent.press(getByTestId("correction-reason-OTHER"));
    expect(getByText("Décrivez le problème")).toBeTruthy();
    await fireEvent.changeText(
      getByTestId("correction-message-input"),
      "Le son coupe à 1:30",
    );
    await fireEvent.press(getByTestId("correction-submit-button"));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        trackId: "track-1",
        reason: "OTHER",
        message: "Le son coupe à 1:30",
      }),
    );
  });

  it("clashs : explique où les placer, et ouvre l'éditeur depuis le lecteur", async () => {
    const onProposeClashes = jest.fn();
    const { getByTestId, queryByTestId, rerender } = await renderModal();
    await fireEvent.press(getByTestId("correction-reason-PASO_CLASH"));
    expect(getByTestId("correction-clash-info")).toBeTruthy();
    expect(queryByTestId("correction-open-clash-editor")).toBeNull();

    const client = new QueryClient();
    await rerender(
      <QueryClientProvider client={client}>
        <TrackCorrectionModal
          visible
          onClose={jest.fn()}
          track={track}
          initialReason="PASO_CLASH"
          onProposeClashes={onProposeClashes}
        />
      </QueryClientProvider>,
    );
    await fireEvent.press(getByTestId("correction-open-clash-editor"));
    expect(onProposeClashes).toHaveBeenCalled();
  });

  it.each([
    [429, "déjà plusieurs propositions en attente"],
    [404, "plus disponible"],
  ])(
    "affiche le message serveur traduit (%i) et reste ouvert",
    async (status, fragment) => {
      createMock.mockRejectedValueOnce(
        new TrackCorrectionApiError(
          status === 429
            ? "Vous avez déjà plusieurs propositions en attente sur cette musique."
            : "Cette musique n'est plus disponible.",
          status,
        ),
      );
      const onClose = jest.fn();
      const { getByTestId } = await renderModal({ onClose });

      await fireEvent.press(getByTestId("correction-reason-OTHER"));
      await fireEvent.changeText(getByTestId("correction-message-input"), "x");
      await fireEvent.press(getByTestId("correction-submit-button"));

      await waitFor(() =>
        expect(Alert.alert).toHaveBeenCalledWith(
          "Envoi impossible",
          expect.stringContaining(fragment),
        ),
      );
      expect(onClose).not.toHaveBeenCalled();
    },
  );
});
