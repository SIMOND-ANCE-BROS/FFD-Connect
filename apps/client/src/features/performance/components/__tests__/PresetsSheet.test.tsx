import { act, fireEvent, render, within } from "@testing-library/react-native";
import React from "react";
import { Alert, type AlertButton } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import type {
  CompetitionPreset,
  SaveResult,
} from "../../../../stores/competitionPresets.store";
import { createDefaultConfig } from "../../../../stores/performance.store";
import { formatPresetDate, PresetsSheet } from "../PresetsSheet";

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
}));

const SAVED_AT = new Date(2026, 9, 11, 12).toISOString();
const preset = (id: string, name: string): CompetitionPreset => ({
  id,
  name,
  updatedAt: SAVED_AT,
  config: createDefaultConfig(),
});
const GALA = preset("p1", "Gala");
const TRAINING = preset("p2", "Entraînement");

const renderSheet = async (
  overrides: Partial<React.ComponentProps<typeof PresetsSheet>> = {},
) => {
  const props = {
    visible: true,
    presets: [GALA, TRAINING],
    activePresetId: null,
    onClose: jest.fn(),
    onLoad: jest.fn(),
    onSave: jest.fn((): SaveResult => ({ ok: true, id: "new" })),
    onReplace: jest.fn(),
    onRename: jest.fn((): SaveResult => ({ ok: true, id: "p1" })),
    onDelete: jest.fn(),
    ...overrides,
  };
  const screen = await render(<PresetsSheet {...props} />);
  return { props, ...screen };
};

/** Presses a button of the last Alert shown. */
const pressAlertButton = async (text: string) => {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1][2] as AlertButton[];
  await act(async () => {
    buttons.find((b) => b.text === text)?.onPress?.();
  });
};

describe("formatPresetDate", () => {
  it("formats a local day", () => {
    expect(formatPresetDate(SAVED_AT)).toBe("11/10/2026");
  });
  it("returns an empty string for an invalid date", () => {
    expect(formatPresetDate("garbage")).toBe("");
  });
});

describe("PresetsSheet", () => {
  beforeEach(() => {
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    (useTheme as jest.Mock).mockReturnValue({
      theme: {
        background: "#fff",
        surface: "#f2f2f2",
        text: "#111",
        textSecondary: "#666",
        primary: "#3b82f6",
        border: "#e5e7eb",
        danger: "#ef4444",
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists the presets with their save date and marks the active one", async () => {
    const { getByText, getAllByText } = await renderSheet({
      activePresetId: "p2",
    });
    expect(getByText("Gala")).toBeTruthy();
    expect(getByText("Entraînement")).toBeTruthy();
    expect(getAllByText(/Enregistré le 11\/10\/2026/)).toHaveLength(2);
    expect(getByText(/En cours/)).toBeTruthy();
  });

  it("keeps the controls out of the backdrop so VoiceOver can reach them", async () => {
    const { getByTestId, props } = await renderSheet();
    const backdrop = getByTestId("performance-presets-backdrop");
    expect(
      within(backdrop).queryByTestId("performance-presets-save"),
    ).toBeNull();
    expect(
      within(backdrop).queryByTestId("performance-presets-close"),
    ).toBeNull();
    await fireEvent.press(backdrop);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("explains the empty list", async () => {
    const { getByTestId } = await renderSheet({ presets: [] });
    expect(getByTestId("performance-presets-empty")).toHaveTextContent(
      /Aucun preset enregistré/,
    );
  });

  it("labels every action with the preset name", async () => {
    const { getByLabelText } = await renderSheet();
    expect(getByLabelText("Charger le preset Gala")).toBeTruthy();
    expect(getByLabelText("Renommer le preset Gala")).toBeTruthy();
    expect(getByLabelText("Supprimer le preset Gala")).toBeTruthy();
  });

  it("loads a preset and closes", async () => {
    const { getByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId("performance-preset-p1-load"));
    expect(props.onLoad).toHaveBeenCalledWith(GALA);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("saves the current programme under a name", async () => {
    const { getByTestId, queryByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId("performance-presets-save"));
    const input = getByTestId("performance-presets-name-input");
    expect(input.props.maxLength).toBe(40);
    await fireEvent.changeText(input, "Championnat");
    await fireEvent.press(getByTestId("performance-presets-form-confirm"));
    expect(props.onSave).toHaveBeenCalledWith("Championnat");
    expect(queryByTestId("performance-presets-name-input")).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("asks for a name", async () => {
    const { getByTestId } = await renderSheet({
      onSave: jest.fn((): SaveResult => ({ ok: false, reason: "empty" })),
    });
    await fireEvent.press(getByTestId("performance-presets-save"));
    await fireEvent.press(getByTestId("performance-presets-form-confirm"));
    expect(getByTestId("performance-presets-error")).toHaveTextContent(
      "Donnez un nom au preset.",
    );
  });

  it("explains the list is full", async () => {
    const { getByTestId } = await renderSheet({
      onSave: jest.fn((): SaveResult => ({ ok: false, reason: "full" })),
    });
    await fireEvent.press(getByTestId("performance-presets-save"));
    await fireEvent.changeText(
      getByTestId("performance-presets-name-input"),
      "Nouveau",
    );
    await fireEvent.press(getByTestId("performance-presets-form-confirm"));
    expect(getByTestId("performance-presets-error")).toHaveTextContent(
      /20 presets maximum/,
    );
  });

  it("offers to replace a preset with the same name", async () => {
    const { getByTestId, queryByTestId, props } = await renderSheet({
      onSave: jest.fn((): SaveResult => ({ ok: false, reason: "duplicate" })),
    });
    await fireEvent.press(getByTestId("performance-presets-save"));
    await fireEvent.changeText(
      getByTestId("performance-presets-name-input"),
      " gala ",
    );
    await fireEvent.press(getByTestId("performance-presets-form-confirm"));
    expect(Alert.alert).toHaveBeenCalledWith(
      "Remplacer ?",
      expect.stringContaining("« Gala »"),
      expect.any(Array),
    );
    expect(props.onReplace).not.toHaveBeenCalled();
    await pressAlertButton("Remplacer");
    expect(props.onReplace).toHaveBeenCalledWith("p1");
    expect(queryByTestId("performance-presets-name-input")).toBeNull();
  });

  it("renames a preset", async () => {
    const { getByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId("performance-preset-p1-rename"));
    const input = getByTestId("performance-presets-name-input");
    expect(input.props.value).toBe("Gala");
    await fireEvent.changeText(input, "Gala 2026");
    await fireEvent.press(getByTestId("performance-presets-form-confirm"));
    expect(props.onRename).toHaveBeenCalledWith("p1", "Gala 2026");
  });

  it("refuses to rename to another preset's name", async () => {
    const { getByTestId } = await renderSheet({
      onRename: jest.fn(
        (): SaveResult => ({
          ok: false,
          reason: "duplicate",
        }),
      ),
    });
    await fireEvent.press(getByTestId("performance-preset-p1-rename"));
    await fireEvent.press(getByTestId("performance-presets-form-confirm"));
    expect(getByTestId("performance-presets-error")).toHaveTextContent(
      "Un autre preset porte déjà ce nom.",
    );
  });

  it("cancels the form", async () => {
    const { getByTestId, queryByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId("performance-presets-save"));
    await fireEvent.press(getByTestId("performance-presets-form-cancel"));
    expect(queryByTestId("performance-presets-name-input")).toBeNull();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("deletes only after confirmation", async () => {
    const { getByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId("performance-preset-p1-delete"));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Supprimer le preset",
      expect.stringContaining("« Gala »"),
      expect.any(Array),
    );
    await pressAlertButton("Supprimer");
    expect(props.onDelete).toHaveBeenCalledWith("p1");
  });

  it("closes", async () => {
    const { getByTestId, props } = await renderSheet();
    await fireEvent.press(getByTestId("performance-presets-close"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("renders nothing when hidden", async () => {
    const { queryByTestId } = await renderSheet({ visible: false });
    expect(queryByTestId("performance-presets-save")).toBeNull();
  });
});
