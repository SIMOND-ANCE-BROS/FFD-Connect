import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import React from "react";
import { Alert } from "react-native";
import { useTheme, ThemeContextType } from "../../../../context/ThemeContext";
import { ReportService } from "../../services/ReportService";
import { ReportModal } from "../ReportModal";

jest.mock("../../services/ReportService", () => ({
  ReportService: {
    sendReport: jest.fn(),
  },
}));
jest.mock("../../../../context/ThemeContext");
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: "granted" }),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: {
    Images: "images",
  },
}));

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

describe("ReportModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [],
    });
    mockUseTheme.mockReturnValue({
      theme: {
        background: "#fff",
        surface: "#f7f7f7",
        text: "#111",
        textSecondary: "#666",
        border: "#e0e0e0",
        primary: "#004481",
      },
      isDark: false,
    } as unknown as ThemeContextType);
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("shows validation alert when required fields are missing", async () => {
    const { getByText } = await render(
      <ReportModal visible onClose={jest.fn()} />,
    );

    await fireEvent.press(getByText("Envoyer le rapport"));
    expect(Alert.alert).toHaveBeenCalled();
    expect(ReportService.sendReport).not.toHaveBeenCalled();
  });

  it("opens image picker when attach button is pressed", async () => {
    const { getByTestId } = await render(
      <ReportModal visible onClose={jest.fn()} />,
    );

    await fireEvent.press(getByTestId("attach-image-button"));
    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    });
  });

  it("submits report successfully and shows success screen", async () => {
    (ReportService.sendReport as jest.Mock).mockResolvedValueOnce(undefined);

    const onClose = jest.fn();
    const { getByText, findByTestId } = await render(
      <ReportModal visible onClose={onClose} />,
    );

    // Remplir les champs obligatoires
    const titleInput = await findByTestId("report-title-input");
    await fireEvent.changeText(titleInput, "Titre du bug");
    const descInput = await findByTestId("report-desc-input");
    await fireEvent.changeText(descInput, "Description");

    await fireEvent.press(getByText("Envoyer le rapport"));

    await waitFor(() => {
      expect(ReportService.sendReport).toHaveBeenCalled();
    });

    // L’UI doit passer en mode succès
    await waitFor(() => {
      expect(getByText("Rapport envoyé !")).toBeTruthy();
    });
  });

  it("shows error alert when ReportService.sendReport fails", async () => {
    (ReportService.sendReport as jest.Mock).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const { getByText, findByTestId } = await render(
      <ReportModal visible onClose={jest.fn()} />,
    );

    const titleInput = await findByTestId("report-title-input");
    await fireEvent.changeText(titleInput, "Titre");
    const descInput = await findByTestId("report-desc-input");
    await fireEvent.changeText(descInput, "Description");

    await fireEvent.press(getByText("Envoyer le rapport"));

    await waitFor(() => {
      expect(ReportService.sendReport).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur",
        "Impossible d'envoyer le rapport. Réessayez plus tard.",
      );
    });
  });

  it("removes image when remove button is pressed", async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///photo.jpg",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    const { getByTestId, queryByText } = await render(
      <ReportModal visible onClose={jest.fn()} />,
    );

    await fireEvent.press(getByTestId("attach-image-button"));
    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(queryByText("photo.jpg")).toBeTruthy();
    });

    await fireEvent.press(getByTestId("remove-image-button"));

    await waitFor(() => {
      expect(queryByText("Joindre une image")).toBeTruthy();
    });
  });

  it("submits suggestion (FEATURE) and shows success with correct message", async () => {
    (ReportService.sendReport as jest.Mock).mockResolvedValueOnce(undefined);

    const { getByText, findByTestId } = await render(
      <ReportModal visible onClose={jest.fn()} />,
    );

    await fireEvent.press(getByText("Suggestion"));

    const titleInput = await findByTestId("report-title-input");
    await fireEvent.changeText(titleInput, "Idée");
    const descInput = await findByTestId("report-desc-input");
    await fireEvent.changeText(descInput, "Description");

    await fireEvent.press(getByText("Envoyer la suggestion"));

    await waitFor(() => {
      expect(ReportService.sendReport).toHaveBeenCalledWith(
        expect.objectContaining({ type: "FEATURE" }),
      );
    });

    await waitFor(() => {
      expect(getByText(/suggestion/)).toBeTruthy();
    });
  });

  it("changes severity and module", async () => {
    const { getByText, findByTestId } = await render(
      <ReportModal visible onClose={jest.fn()} />,
    );

    // Default severity is MEDIUM (Gênant), change to LOW (Mineur)
    await fireEvent.press(getByText("Mineur"));
    // Module selection - find a module option
    await fireEvent.press(getByText("Licences"));

    // Fill title/desc to enable sending
    const titleInput = await findByTestId("report-title-input");
    await fireEvent.changeText(titleInput, "Issue");
    const descInput = await findByTestId("report-desc-input");
    await fireEvent.changeText(descInput, "Details");

    await fireEvent.press(getByText("Envoyer le rapport"));

    await waitFor(() => {
      expect(ReportService.sendReport).toHaveBeenCalled();
    });
  });

  it("handles steps to reproduce input", async () => {
    await render(<ReportModal visible onClose={jest.fn()} />);

    const stepsInput = screen.getByTestId("report-steps-input");
    await fireEvent.changeText(stepsInput, "1. Open app\n2. Click button");

    expect(stepsInput.props.value).toBe("1. Open app\n2. Click button");
  });

  it("calls onClose when close button is pressed on success screen", async () => {
    (ReportService.sendReport as jest.Mock).mockResolvedValueOnce(undefined);

    const onClose = jest.fn();
    const { getByText, findByTestId } = await render(
      <ReportModal visible onClose={onClose} />,
    );

    const titleInput = await findByTestId("report-title-input");
    await fireEvent.changeText(titleInput, "Titre");
    const descInput = await findByTestId("report-desc-input");
    await fireEvent.changeText(descInput, "Description");

    await fireEvent.press(getByText("Envoyer le rapport"));

    await waitFor(() => {
      expect(getByText("Rapport envoyé !")).toBeTruthy();
    });

    await fireEvent.press(getByText("Fermer"));

    expect(onClose).toHaveBeenCalled();
  });

  it("handles image picker permission denial", async () => {
    (
      ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
    ).mockResolvedValue({
      status: "denied",
    });
    const alertSpy = jest.spyOn(Alert, "alert");

    await render(<ReportModal visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId("attach-image-button"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Permission requise",
        "Accès à la galerie photo nécessaire.",
      );
    });
    alertSpy.mockRestore();
  });

  it("handles report submission error", async () => {
    (ReportService.sendReport as jest.Mock).mockRejectedValue(
      new Error("API Error"),
    );
    const alertSpy = jest.spyOn(Alert, "alert");

    await render(<ReportModal visible onClose={jest.fn()} />);

    // Explicitly click BUG (it is usually initial, but this ensures onPress is covered)
    await fireEvent.press(screen.getByTestId("report-type-bug"));

    await fireEvent.changeText(
      screen.getByTestId("report-title-input"),
      "App crashes",
    );
    await fireEvent.changeText(screen.getByTestId("report-desc-input"), "Desc");
    await fireEvent.press(screen.getByText("Envoyer le rapport"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Erreur",
        "Impossible d'envoyer le rapport. Réessayez plus tard.",
      );
    });
    alertSpy.mockRestore();
  });

  it("handles removing attached image", async () => {
    (
      ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
    ).mockResolvedValue({
      status: "granted",
    });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "test-uri" }],
    });

    await render(<ReportModal visible onClose={jest.fn()} />);

    // Attach
    await fireEvent.press(screen.getByTestId("attach-image-button"));
    await waitFor(() => {
      expect(screen.getByTestId("remove-image-button")).toBeTruthy();
    });

    // Remove
    await fireEvent.press(screen.getByTestId("remove-image-button"));
    expect(screen.queryByTestId("remove-image-button")).toBeNull();
  });

  it("handles suggestion (FEATURE) mode", async () => {
    (ReportService.sendReport as jest.Mock).mockResolvedValue({
      success: true,
    });

    await render(<ReportModal visible onClose={jest.fn()} />);

    // Switch to FEATURE (Suggestion)
    await fireEvent.press(screen.getByTestId("report-type-feature"));

    await fireEvent.changeText(
      screen.getByTestId("report-title-input"),
      "New Idea",
    );
    await fireEvent.changeText(
      screen.getByTestId("report-desc-input"),
      "Cool feature",
    );

    // Suggestion mode should NOT show steps to reproduce
    expect(
      screen.queryByPlaceholderText("1. Aller sur... 2. Cliquer sur..."),
    ).toBeNull();

    await fireEvent.press(screen.getByTestId("report-submit-button"));

    await waitFor(() => {
      expect(ReportService.sendReport).toHaveBeenCalled();
    });
  });

  it("handles image picker cancellation", async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: true,
    });
    const { getByTestId, queryByTestId } = await render(
      <ReportModal visible onClose={jest.fn()} />,
    );

    await fireEvent.press(getByTestId("attach-image-button"));
    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    });

    expect(queryByTestId("remove-image-button")).toBeNull();
  });

  it("verifies HIGH severity is handled correctly", async () => {
    const { getByTestId, findByTestId } = await render(
      <ReportModal visible onClose={jest.fn()} />,
    );

    // Test HIGH
    await fireEvent.press(getByTestId("report-severity-high"));

    // Fill required to enable submit button or verify state
    await fireEvent.changeText(
      await findByTestId("report-title-input"),
      "Critical",
    );
    await fireEvent.changeText(
      await findByTestId("report-desc-input"),
      "Blocker",
    );

    await fireEvent.press(getByTestId("report-submit-button"));

    await waitFor(() => {
      expect(ReportService.sendReport).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "HIGH" }),
      );
    });
  });

  it("verifies LOW severity is handled correctly", async () => {
    const { getByTestId, findByTestId } = await render(
      <ReportModal visible onClose={jest.fn()} />,
    );

    // Test LOW
    await fireEvent.press(getByTestId("report-severity-low"));

    // Fill required
    await fireEvent.changeText(
      await findByTestId("report-title-input"),
      "Minor",
    );
    await fireEvent.changeText(
      await findByTestId("report-desc-input"),
      "Notice",
    );

    await fireEvent.press(getByTestId("report-submit-button"));

    await waitFor(() => {
      expect(ReportService.sendReport).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "LOW" }),
      );
    });
  });
});
