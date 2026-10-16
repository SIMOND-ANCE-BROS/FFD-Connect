import { act, renderHook } from "@testing-library/react-native";
import { Alert } from "react-native";
import { CheckinService } from "../../../license/services/CheckinService";
import {
  checkInOffline,
  purgeExpiredCheckins,
  OFFLINE_CHECKIN_MESSAGES,
  refreshEntryQrKeys,
} from "../../../license/services/offlineCheckin";
import { useVolunteerCheckinLogic } from "../useVolunteerCheckinLogic";

jest.mock("../../../license/services/CheckinService", () => ({
  CheckinService: { checkInAsVolunteer: jest.fn() },
}));
jest.mock("../../../license/services/offlineCheckin", () => {
  const actual = jest.requireActual("../../../license/services/offlineCheckin");
  return {
    ...actual,
    checkInOffline: jest.fn(),
    refreshEntryQrKeys: jest.fn().mockResolvedValue(null),
    purgeExpiredCheckins: jest.fn().mockResolvedValue(0),
  };
});

const checkInAsVolunteer = CheckinService.checkInAsVolunteer as jest.Mock;

describe("useVolunteerCheckinLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("downloads the verification keys when the scanner opens (#24)", async () => {
    await renderHook(() => useVolunteerCheckinLogic("c1", "tok"));
    expect(refreshEntryQrKeys).toHaveBeenCalled();
    expect(purgeExpiredCheckins).toHaveBeenCalled();
  });

  it("checks in online and shows the result", async () => {
    const response = {
      user: { firstName: "Jean", lastName: "Dupont" },
      registrations: [{ event: "Latin", status: "SUCCESS" }],
    };
    checkInAsVolunteer.mockResolvedValue(response);
    const { result } = await renderHook(() =>
      useVolunteerCheckinLogic("c1", "tok"),
    );
    await act(async () => {
      await result.current.actions.handleBarCodeScanned("qr");
    });
    expect(checkInAsVolunteer).toHaveBeenCalledWith("c1", "tok", "qr");
    expect(result.current.state.lastCheckin).toBe(response);
    expect(Alert.alert).toHaveBeenCalledWith(
      "Check-in réussi",
      expect.stringContaining("Jean Dupont"),
    );
  });

  it("verifies offline and queues the volunteer check-in without network", async () => {
    checkInAsVolunteer.mockRejectedValue({
      isAxiosError: true,
      message: "Network Error",
    });
    (checkInOffline as jest.Mock).mockResolvedValue({
      status: "VALID",
      holderName: "DUPONT Jean",
      licenseNumber: "FFD-1",
      queued: true,
    });
    const { result } = await renderHook(() =>
      useVolunteerCheckinLogic("c1", "tok"),
    );
    await act(async () => {
      await result.current.actions.handleBarCodeScanned("qr-v3");
    });
    expect(checkInOffline).toHaveBeenCalledWith({
      qrData: "qr-v3",
      endpoint: "POST /competitions/checkin/volunteer",
      payload: { competitionId: "c1", token: "tok" },
      competitionId: "c1",
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "LICENCE VÉRIFIÉE (HORS LIGNE)",
      `DUPONT Jean\n\n${OFFLINE_CHECKIN_MESSAGES.VALID_QUEUED}`,
    );
    expect(result.current.state.isValidating).toBe(false);
  });

  it("shows the offline verdict alone when the QR names nobody", async () => {
    checkInAsVolunteer.mockRejectedValue({ isAxiosError: true });
    (checkInOffline as jest.Mock).mockResolvedValue({
      status: "NOT_ENTRY_QR",
      queued: false,
    });
    const { result } = await renderHook(() =>
      useVolunteerCheckinLogic("c1", "tok"),
    );
    await act(async () => {
      await result.current.actions.handleBarCodeScanned("static");
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "VÉRIFICATION EN LIGNE REQUISE",
      OFFLINE_CHECKIN_MESSAGES.NOT_ENTRY_QR,
    );
  });

  it("shows the server message of a refused check-in", async () => {
    checkInAsVolunteer.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: "QR non vérifié" } },
    });
    const { result } = await renderHook(() =>
      useVolunteerCheckinLogic("c1", "tok"),
    );
    await act(async () => {
      await result.current.actions.handleBarCodeScanned("qr");
    });
    expect(checkInOffline).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith("Erreur", "QR non vérifié");
  });
});
