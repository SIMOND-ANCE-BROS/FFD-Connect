import { act, renderHook } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";
import { ReportService } from "../../services/ReportService";
import { useReportModalLogic } from "../useReportModalLogic";

jest.mock("../../services/ReportService", () => ({
  ReportService: {
    sendReport: jest.fn(),
  },
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: "images" },
}));

describe("useReportModalLogic", () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("initializes with default state", async () => {
    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    expect(result.current.state.type).toBe("BUG");
    expect(result.current.state.title).toBe("");
    expect(result.current.state.isSubmitting).toBe(false);
  });

  it("handles image selection", async () => {
    (
      ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
    ).mockResolvedValue({ status: "granted" });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "test-uri", fileName: "test.jpg", mimeType: "image/jpeg" },
      ],
    });

    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(async () => {
      await result.current.actions.handlePickImage();
    });

    expect(result.current.state.image).toEqual({
      uri: "test-uri",
      fileName: "test.jpg",
      mimeType: "image/jpeg",
    });
  });

  it("shows error if image permission is denied", async () => {
    (
      ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
    ).mockResolvedValue({ status: "denied" });

    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(async () => {
      await result.current.actions.handlePickImage();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "Permission requise",
      expect.any(String),
    );
  });

  it("validates form before submission", async () => {
    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(async () => {
      await result.current.actions.handleSubmit();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      expect.stringContaining("remplir"),
    );
    expect(ReportService.sendReport).not.toHaveBeenCalled();
  });

  it("submits report successfully", async () => {
    (ReportService.sendReport as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(() => {
      result.current.actions.setTitle("Bug title");
      result.current.actions.setDescription("Bug description");
    });

    await act(async () => {
      await result.current.actions.handleSubmit();
    });

    expect(result.current.state.isSuccess).toBe(true);
    expect(ReportService.sendReport).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Bug title",
        description: "Bug description",
        // Plus de "0.0.1" en dur : version + build, variante, SHA, OTA.
        appVersion: expect.stringMatching(/^1\.0\.0 \(85\) · /),
      }),
    );
  });

  it("handles submission failure", async () => {
    (ReportService.sendReport as jest.Mock).mockRejectedValue(
      new Error("Failed"),
    );

    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(() => {
      result.current.actions.setTitle("Bug title");
      result.current.actions.setDescription("Bug description");
    });

    await act(async () => {
      await result.current.actions.handleSubmit();
    });

    expect(result.current.state.isSuccess).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith("Erreur", expect.any(String));
  });

  it("resets form and closes on handleClose", async () => {
    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(() => {
      result.current.actions.setTitle("Dirty title");
      result.current.actions.handleClose();
    });

    expect(mockOnClose).toHaveBeenCalled();
    expect(result.current.state.title).toBe("");
  });

  it("setTitle updates title state", async () => {
    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(() => {
      result.current.actions.setTitle("My title");
    });

    expect(result.current.state.title).toBe("My title");
  });

  it("setDescription updates description state", async () => {
    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(() => {
      result.current.actions.setDescription("My description");
    });

    expect(result.current.state.description).toBe("My description");
  });

  it("setSeverity updates severity state", async () => {
    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(() => {
      result.current.actions.setSeverity("HIGH");
    });

    expect(result.current.state.severity).toBe("HIGH");
  });

  it("setType updates type state", async () => {
    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(() => {
      result.current.actions.setType("FEATURE");
    });

    expect(result.current.state.type).toBe("FEATURE");
  });

  it("does not call service when only description is missing", async () => {
    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(() => {
      result.current.actions.setTitle("Has title");
    });

    await act(async () => {
      await result.current.actions.handleSubmit();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      expect.stringContaining("remplir"),
    );
    expect(ReportService.sendReport).not.toHaveBeenCalled();
  });

  it("handleRemoveImage clears the image", async () => {
    (
      ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
    ).mockResolvedValue({ status: "granted" });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file://img.jpg", fileName: "img.jpg", mimeType: "image/jpeg" },
      ],
    });

    const { result } = await renderHook(() =>
      useReportModalLogic({ onClose: mockOnClose }),
    );

    await act(async () => {
      await result.current.actions.handlePickImage();
    });

    expect(result.current.state.image).not.toBeNull();

    await act(() => {
      result.current.actions.handleRemoveImage();
    });

    expect(result.current.state.image).toBeNull();
  });
});
