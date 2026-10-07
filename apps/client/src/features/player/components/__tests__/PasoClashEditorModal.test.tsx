import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render as rtlRender,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { BackendService } from "../../../../services/BackendService";
import {
  TrackCorrectionApi,
  TrackCorrectionApiError,
} from "../../../../services/api/track-correction-api";
import { PasoClashEditorModal } from "../PasoClashEditorModal";

jest.mock("../../../../services/api/track-correction-api", () => {
  const actual = jest.requireActual<
    typeof import("../../../../services/api/track-correction-api")
  >("../../../../services/api/track-correction-api");
  return { ...actual, TrackCorrectionApi: { create: jest.fn() } };
});

// L'éditeur utilise React Query (mode proposition) : il lui faut un client.
const render = (ui: React.ReactElement) =>
  rtlRender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      primary: "#007AFF",
      warning: "#e67e22",
      border: "#ccc",
    },
    isDark: false,
  }),
}));

jest.mock("../../../../services/BackendService", () => ({
  BackendService: { updateTrack: jest.fn().mockResolvedValue(undefined) },
}));

const baseProps = {
  visible: true,
  trackId: "t1",
  style: "Paso Doble",
  clashTimecodes: undefined,
  position: 42,
  duration: 120,
  isPlaying: false,
  onTogglePlay: jest.fn(),
  onSeek: jest.fn(),
  onClose: jest.fn(),
  onSaved: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  (TrackCorrectionApi.create as jest.Mock).mockResolvedValue({ id: "c1" });
});

describe("PasoClashEditorModal", () => {
  it("pré-remplit avec l'estimation par défaut (3 appels)", async () => {
    const { getByTestId } = await render(
      <PasoClashEditorModal {...baseProps} />,
    );
    // 3 appels par défaut (40/80/120 pour 120s)
    expect(getByTestId("paso-remove-point-0")).toBeTruthy();
    expect(getByTestId("paso-remove-point-2")).toBeTruthy();
  });

  it("« poser un appel » ajoute la position courante", async () => {
    const { getByTestId, queryByTestId } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[]} />,
    );
    // Démarre vide (pas de style paso ? non, paso → estimation). Forçons vide via non-paso puis re-check.
    await fireEvent.press(getByTestId("paso-add-point"));
    // Un point de plus doit apparaître
    expect(queryByTestId("paso-remove-point-0")).toBeTruthy();
  });

  it("calcul auto remplit la liste", async () => {
    const { getByTestId } = await render(
      <PasoClashEditorModal {...baseProps} style="Paso Doble" />,
    );
    await fireEvent.press(getByTestId("paso-auto-compute"));
    expect(getByTestId("paso-remove-point-0")).toBeTruthy();
  });

  it("enregistre via BackendService et notifie onSaved", async () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <PasoClashEditorModal
        {...baseProps}
        clashTimecodes={[10, 20]}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );

    await fireEvent.press(getByTestId("paso-save"));

    await waitFor(() => {
      expect(BackendService.updateTrack).toHaveBeenCalledWith("t1", {
        clashTimecodes: [10, 20],
      });
      expect(onSaved).toHaveBeenCalledWith([10, 20]);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("supprime un appel", async () => {
    const { getByTestId, queryByTestId } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[10, 20, 30]} />,
    );
    await fireEvent.press(getByTestId("paso-remove-point-0"));
    // Il ne reste que 2 appels → l'index 2 n'existe plus
    expect(queryByTestId("paso-remove-point-2")).toBeNull();
  });

  describe("mode proposition (non-admin)", () => {
    it("envoie les appels placés et le commentaire aux admins, sans toucher la piste", async () => {
      const onSaved = jest.fn();
      const onClose = jest.fn();
      const { getByTestId, getByText, queryByTestId } = await render(
        <PasoClashEditorModal
          {...baseProps}
          mode="propose"
          clashTimecodes={[10, 20]}
          onSaved={onSaved}
          onClose={onClose}
        />,
      );

      expect(getByText("Proposer les appels")).toBeTruthy();
      expect(queryByTestId("paso-save")).toBeNull();
      await fireEvent.press(getByTestId("paso-add-point"));
      await fireEvent.changeText(
        getByTestId("paso-propose-comment"),
        "  le 2e est en retard  ",
      );
      await fireEvent.press(getByTestId("paso-propose"));

      await waitFor(() =>
        expect(TrackCorrectionApi.create).toHaveBeenCalledWith({
          trackId: "t1",
          reason: "PASO_CLASH",
          clashTimecodes: [10, 20, 42],
          message: "le 2e est en retard",
        }),
      );
      expect(BackendService.updateTrack).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        "Merci !",
        "Proposition envoyée aux administrateurs.",
      );
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("omet le commentaire vide", async () => {
      const { getByTestId } = await render(
        <PasoClashEditorModal
          {...baseProps}
          mode="propose"
          clashTimecodes={[10]}
        />,
      );
      await fireEvent.press(getByTestId("paso-propose"));
      await waitFor(() =>
        expect(TrackCorrectionApi.create).toHaveBeenCalledWith({
          trackId: "t1",
          reason: "PASO_CLASH",
          clashTimecodes: [10],
        }),
      );
    });

    it("affiche l'erreur traduite et reste ouvert (429)", async () => {
      (TrackCorrectionApi.create as jest.Mock).mockRejectedValueOnce(
        new TrackCorrectionApiError("Trop de propositions en attente", 429),
      );
      const onClose = jest.fn();
      const { getByTestId } = await render(
        <PasoClashEditorModal
          {...baseProps}
          mode="propose"
          clashTimecodes={[10]}
          onClose={onClose}
        />,
      );
      await fireEvent.press(getByTestId("paso-propose"));
      await waitFor(() =>
        expect(Alert.alert).toHaveBeenCalledWith(
          "Envoi impossible",
          "Trop de propositions en attente",
        ),
      );
      expect(onClose).not.toHaveBeenCalled();
    });

    it("refuse plus de 10 appels", async () => {
      const { getByTestId } = await render(
        <PasoClashEditorModal
          {...baseProps}
          mode="propose"
          clashTimecodes={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]}
        />,
      );
      await fireEvent.press(getByTestId("paso-propose"));
      expect(TrackCorrectionApi.create).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        "Trop d'appels",
        "Proposez au plus 10 appels.",
      );
    });
  });
});
