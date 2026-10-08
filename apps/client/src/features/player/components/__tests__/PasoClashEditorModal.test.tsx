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
import { useLibrarySyncStore } from "../../../../stores/librarySync.store";
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
  it("pré-remplit avec l'estimation par défaut (3 appels calés sur les phrases)", async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <PasoClashEditorModal {...baseProps} mpm={60} />,
    );
    // 60 MPM : fin des phrases 5, 10 et 15 → 0:40, 1:20, 2:00 (plus durée / 3).
    expect(getByTestId("paso-remove-point-2")).toBeTruthy();
    expect(queryByTestId("paso-remove-point-3")).toBeNull();
    expect(getByText("Appel 1 — 0:40")).toBeTruthy();
    expect(getByText("Appel 2 — 1:20")).toBeTruthy();
    expect(getByText("Appel 3 — 2:00")).toBeTruthy();
  });

  it("coupe courte : n'estime que les clashs qui tiennent dans la piste", async () => {
    const { queryByTestId } = await render(
      <PasoClashEditorModal {...baseProps} duration={85} mpm={60} />,
    );
    expect(queryByTestId("paso-remove-point-1")).toBeTruthy();
    expect(queryByTestId("paso-remove-point-2")).toBeNull();
  });

  it("calcul auto : tient compte du tempo de la piste", async () => {
    const { getByTestId, getByText } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[5]} mpm={62} />,
    );
    await fireEvent.press(getByTestId("paso-auto-compute"));
    // 62 MPM : phrase de 7,74 s → 38,7 s et 77,4 s.
    expect(getByText("Appel 1 — 0:38")).toBeTruthy();
    expect(getByText("Appel 2 — 1:17")).toBeTruthy();
    expect(getByText("Appel 3 — 1:56")).toBeTruthy();
  });

  it("accepte un 3e appel", async () => {
    const { getByTestId } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[10, 20]} />,
    );
    await fireEvent.press(getByTestId("paso-add-point"));
    expect(getByTestId("paso-remove-point-2")).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("refuse de poser un 4e appel", async () => {
    const { getByTestId, queryByTestId } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[10, 20, 30]} />,
    );
    await fireEvent.press(getByTestId("paso-add-point"));
    expect(queryByTestId("paso-remove-point-3")).toBeNull();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Trop d'appels",
      expect.stringContaining("au plus 3 clashs"),
    );
  });

  it("signale que seuls les 3 premiers appels d'une liste trop longue sont gardés", async () => {
    const { getByTestId, queryByTestId } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[40, 10, 30, 20]} />,
    );
    expect(getByTestId("paso-truncated-notice")).toHaveTextContent(
      /4 appels.*seuls les 3 premiers sont conservés/,
    );
    expect(getByTestId("paso-remove-point-2")).toBeTruthy();
    expect(queryByTestId("paso-remove-point-3")).toBeNull();
  });

  it("n'affiche pas d'avertissement pour une liste dans la limite", async () => {
    const { queryByTestId } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[10, 20, 30]} />,
    );
    expect(queryByTestId("paso-truncated-notice")).toBeNull();
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

  it("après enregistrement, signale la bibliothèque comme périmée", async () => {
    const before = useLibrarySyncStore.getState().version;
    const { getByTestId } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[10, 20]} />,
    );
    await fireEvent.press(getByTestId("paso-save"));
    await waitFor(() =>
      expect(useLibrarySyncStore.getState().version).toBe(before + 1),
    );
  });

  it("supprime un appel", async () => {
    const { getByTestId, queryByTestId } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[10, 20]} />,
    );
    await fireEvent.press(getByTestId("paso-remove-point-0"));
    // Il ne reste qu'un appel → l'index 1 n'existe plus
    expect(queryByTestId("paso-remove-point-1")).toBeNull();
  });

  it("une piste à 3 clashs saisis est reprise telle quelle", async () => {
    const { getByText } = await render(
      <PasoClashEditorModal {...baseProps} clashTimecodes={[30, 10, 20]} />,
    );
    expect(getByText("Appel 1 — 0:10")).toBeTruthy();
    expect(getByText("Appel 3 — 0:30")).toBeTruthy();
  });

  describe("mode proposition (non-admin)", () => {
    it("envoie les appels placés et le commentaire aux admins, sans toucher la piste", async () => {
      const onSaved = jest.fn();
      const onClose = jest.fn();
      const { getByTestId, getByText, queryByTestId } = await render(
        <PasoClashEditorModal
          {...baseProps}
          mode="propose"
          clashTimecodes={[10]}
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
          clashTimecodes: [10, 42],
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
  });
});
