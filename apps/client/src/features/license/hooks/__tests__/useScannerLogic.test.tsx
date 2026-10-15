import { act, renderHook, waitFor } from "@testing-library/react-native";
import { CheckinService } from "../../services/CheckinService";
import {
  checkInOffline,
  purgeExpiredCheckins,
  refreshEntryQrKeys,
} from "../../services/offlineCheckin";
import { useScannerLogic } from "../useScannerLogic";

jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: jest.fn(() => [
    { granted: true, canAskAgain: true, expires: "never", status: "granted" },
    jest.fn().mockResolvedValue({ granted: true, status: "granted" }),
  ]),
}));

jest.mock("../../services/offlineCheckin", () => ({
  checkInOffline: jest.fn(),
  refreshEntryQrKeys: jest.fn().mockResolvedValue(null),
  purgeExpiredCheckins: jest.fn().mockResolvedValue(0),
}));

jest.mock("../../services/CheckinService", () => ({
  CheckinService: {
    checkIn: jest.fn(),
    getActiveCompetition: jest.fn(),
  },
}));

describe("useScannerLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("toggles torch state", async () => {
    const { result } = await renderHook(() => useScannerLogic("comp-1"));
    expect(result.current.state.torch).toBe("off");

    await act(() => {
      result.current.actions.toggleTorch();
    });

    expect(result.current.state.torch).toBe("on");
  });

  it("checks in when code is scanned", async () => {
    (CheckinService.getActiveCompetition as jest.Mock).mockResolvedValue({
      id: "comp-1",
      title: "Comp",
    });
    (CheckinService.checkIn as jest.Mock).mockResolvedValue({
      user: { firstName: "Test", lastName: "User" },
      registrations: [{ event: "Event", status: "SUCCESS", bibNumber: 1 }],
    });

    const { result } = await renderHook(() => useScannerLogic("comp-1"));

    await waitFor(() => {
      expect(result.current.state.error).toBeNull();
    });

    await act(async () => {
      void result.current.actions.handleBarcodeScanned({
        data: "qr-1",
      } as never);
    });

    await waitFor(() => {
      expect(result.current.state.result).toBeTruthy();
    });

    expect(CheckinService.checkIn).toHaveBeenCalledWith("comp-1", "qr-1");
  });

  it("handles simulation", async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => useScannerLogic("comp-1"));

    await act(() => {
      result.current.actions.simulateScan(true);
    });

    expect(result.current.state.isLoading).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(result.current.state.result).toBeTruthy();
    expect(result.current.state.isLoading).toBe(false);

    await act(() => {
      result.current.actions.resetScan();
    });

    expect(result.current.state.result).toBeNull();
    expect(result.current.state.isActive).toBe(true);

    jest.useRealTimers();
  });

  it("handles simulation error", async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => useScannerLogic("comp-1"));

    await act(() => {
      result.current.actions.simulateScan(false);
    });

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(result.current.state.error).toBe(
      "Utilisateur non inscrit ou droits non payés",
    );
    expect(result.current.state.isLoading).toBe(false);

    jest.useRealTimers();
  });

  it("affiche le message métier du backend en cas d'erreur de check-in", async () => {
    (CheckinService.getActiveCompetition as jest.Mock).mockResolvedValue({
      id: "comp-1",
      title: "Comp",
    });
    // Erreur axios (404) avec message métier → on affiche ce message, pas
    // « Request failed with status code 404 ».
    (CheckinService.checkIn as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: {
        data: { message: "Utilisateur introuvable avec ce QR Code" },
      },
      message: "Request failed with status code 404",
    });

    const { result } = await renderHook(() => useScannerLogic("comp-1"));
    await waitFor(() => expect(result.current.state.error).toBeNull());

    await act(async () => {
      void result.current.actions.handleBarcodeScanned({
        data: "qr-x",
      } as never);
    });

    await waitFor(() => {
      expect(result.current.state.error).toBe(
        "Utilisateur introuvable avec ce QR Code",
      );
    });
  });

  it("verifies the QR offline and queues the check-in without network (#24)", async () => {
    const offline = {
      status: "VALID",
      holderName: "DUPONT Jean",
      licenseNumber: "FFD-1",
      queued: true,
    };
    (checkInOffline as jest.Mock).mockResolvedValue(offline);
    // No HTTP answer at all: axios network error.
    (CheckinService.checkIn as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      message: "Network Error",
    });

    const { result } = await renderHook(() => useScannerLogic("comp-1"));
    expect(refreshEntryQrKeys).toHaveBeenCalled();
    expect(purgeExpiredCheckins).toHaveBeenCalled();

    await act(async () => {
      void result.current.actions.handleBarcodeScanned({
        data: "qr-v3",
      } as never);
    });

    await waitFor(() => {
      expect(result.current.state.offlineResult).toEqual(offline);
    });
    expect(result.current.state.error).toBeNull();
    expect(checkInOffline).toHaveBeenCalledWith({
      qrData: "qr-v3",
      endpoint: "POST /competitions/comp-1/checkin",
      competitionId: "comp-1",
    });

    await act(() => {
      result.current.actions.resetScan();
    });
    expect(result.current.state.offlineResult).toBeNull();
  });

  it("handles missing competition", async () => {
    (CheckinService.getActiveCompetition as jest.Mock).mockResolvedValue(null);

    const { result } = await renderHook(() => useScannerLogic());

    await waitFor(() => {
      expect(result.current.state.error).toBe(
        "Aucune compétition active aujourd'hui.",
      );
    });

    await act(async () => {
      void result.current.actions.handleBarcodeScanned({
        data: "qr-1",
      } as never);
    });

    expect(CheckinService.checkIn).not.toHaveBeenCalled();
  });
});
