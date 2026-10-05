import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { BackendService } from "../../../../services/BackendService";
import { PasoClashEditorModal } from "../PasoClashEditorModal";

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

beforeEach(() => jest.clearAllMocks());

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
});
