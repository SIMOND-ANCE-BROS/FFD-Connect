import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AxiosError, AxiosHeaders } from "axios";
import {
  mockAuthRepository,
  mockUserRole,
} from "../../../../__tests__/mocks/mockAuthRepository";
import { mockNavigation } from "../../../../__tests__/mocks/mockNavigation";
import { isDeviceOffline } from "../../../../utils/connectivity";
import {
  ACCOUNT_CLUB_UNKNOWN,
  ACCOUNT_NAME_UNKNOWN,
} from "../../utils/accountCard";
import {
  loadLicenseSnapshot,
  saveLicenseSnapshot,
} from "../../utils/licenseSnapshot";
import { useLicenseLogic } from "../useLicenseLogic";

jest.mock("../../../../utils/connectivity", () => ({
  isDeviceOffline: jest.fn(() => Promise.resolve(false)),
}));

jest.mock("../../utils/licenseSnapshot", () => ({
  loadLicenseSnapshot: jest.fn(() => Promise.resolve(null)),
  saveLicenseSnapshot: jest.fn(() => Promise.resolve()),
}));

const mockIsDeviceOffline = isDeviceOffline as jest.MockedFunction<
  typeof isDeviceOffline
>;
const mockLoadSnapshot = loadLicenseSnapshot as jest.MockedFunction<
  typeof loadLicenseSnapshot
>;

// Mock navigation
jest.mock("@react-navigation/native", () => {
  const actualNav = jest.requireActual("@react-navigation/native");
  const React = require("react");
  return {
    ...actualNav,
    // Comme le vrai useFocusEffect: exécute le callback via un effet (au focus =
    // au montage ici), PAS à chaque render. Un appel direct `callback()` relance
    // loadData à chaque re-render → boucle infinie que le rendu async de RNTL 14
    // (await render/renderHook) n'atteint jamais quiescent → timeout.
    useFocusEffect: jest.fn((callback) => {
      React.useEffect(() => callback(), [callback]);
    }),
    useNavigation: jest.fn(() => mockNavigation),
  };
});

// Mock AuthContext
jest.mock("../../../../features/auth/context/AuthContext", () => ({
  useAuthRepository: () => mockAuthRepository,
  UserRole: mockUserRole,
}));

// Mock external dependencies
jest.mock("../../../../utils/platform-adapters", () => ({
  PDFAdapter: {
    generatePDF: jest.fn(() => Promise.resolve({ filePath: "path/to/pdf" })),
  },
  ShareAdapter: {
    open: jest.fn(),
  },
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(),
}));

jest.mock("react-native-reanimated", () => ({
  useSharedValue: jest.fn((v) => ({ value: v })),
  useAnimatedStyle: jest.fn(() => ({})),
  withTiming: jest.fn(),
  withSpring: jest.fn(),
  runOnJS: jest.fn((fn) => fn),
  Easing: {
    inOut: jest.fn(),
    quad: jest.fn(),
  },
  createAnimatedComponent: (c: React.ComponentType<object>) => c,
}));

jest.mock("react-native-gesture-handler", () => ({
  Gesture: {
    Pan: jest.fn().mockReturnThis(),
    enabled: jest.fn().mockReturnThis(),
    activeOffsetY: jest.fn().mockReturnThis(),
    failOffsetX: jest.fn().mockReturnThis(),
    onUpdate: jest.fn().mockReturnThis(),
    onEnd: jest.fn().mockReturnThis(),
  },
}));

import type { MockAlertButtons } from "../../../../__tests__/mocks/types";

// Mock Alert and Platform separately to avoid TurboModuleRegistry issues
jest.mock("react-native", () => {
  const mockAlert = jest.fn(
    (_title: string, _message?: string, buttons?: MockAlertButtons) => {
      // Execute the last button (destructive) by default for testing
      if (buttons && buttons.length > 0) {
        const lastButton = buttons[buttons.length - 1];
        if (lastButton.onPress) {
          lastButton.onPress();
        }
      }
    },
  );

  return {
    ...jest.requireActual("@react-native/jest-preset/jest/mock"),
    Alert: {
      alert: mockAlert,
    },
    Platform: {
      OS: "ios",
      Version: "17.0",
      select: (options: Record<string, unknown>) =>
        options.ios ?? options.default ?? options,
    },
  };
});

describe("useLicenseLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default implementation to update config when set
    mockAuthRepository.setWdsfLicenseEnabled.mockImplementation(
      (enabled: boolean) => {
        mockAuthRepository.getAuthConfig.mockResolvedValue({
          role: "LICENSEE",
          hasWdsfLicense: enabled,
          licensePhotoUri: "test-uri",
        });
        return Promise.resolve();
      },
    );
  });

  it("should load initial configuration on mount", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      licensePhotoUri: "test-uri",
      hasWdsfLicense: true,
      role: "LICENSEE",
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(result.current.state.photoUri).toBe("test-uri");
    });

    expect(result.current.state.photoUri).toBe("test-uri");
    expect(result.current.state.showWdsf).toBe(true);
    expect(result.current.state.role).toBe("LICENSEE");
  });

  it("should handle WDSF verification success", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      authToken: "token",
      isLoggedIn: true,
    });
    mockAuthRepository.verifyWdsfLicense.mockResolvedValue({});

    const { result } = await renderHook(() => useLicenseLogic());

    // Wait for initial load
    await waitFor(() =>
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled(),
    );

    await act(async () => {
      await result.current.actions.handleVerifyWdsf("123456");
    });

    await waitFor(() => {
      expect(mockAuthRepository.verifyWdsfLicense).toHaveBeenCalledWith(
        "123456",
      );
    });

    await waitFor(() => {
      expect(result.current.state.showWdsf).toBe(true);
    });

    expect(result.current.state.activeCardIndex).toBe(1);
    expect(result.current.state.wdsfError).toBeNull();
  });

  it("should handle WDSF verification failure", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      authToken: "token",
      isLoggedIn: true,
    });
    mockAuthRepository.verifyWdsfLicense.mockRejectedValue(
      new Error("Invalid MIN"),
    );

    const { result } = await renderHook(() => useLicenseLogic());

    // Wait for initial load
    await waitFor(() =>
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled(),
    );

    // Call the action without awaiting inside act to avoid hanging
    result.current.actions.handleVerifyWdsf("bad-min").catch(() => {});

    await waitFor(
      () => {
        expect(result.current.state.wdsfError).toBe("Invalid MIN");
      },
      { timeout: 5000 },
    );
    expect(result.current.state.showWdsf).toBe(false);
  });

  it("does not show the WDSF card when the backend refuses the MIN (name mismatch)", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      authToken: "token",
      isLoggedIn: true,
    });
    mockAuthRepository.verifyWdsfLicense.mockResolvedValue({
      licenseNumber: "10117265",
      firstName: "Bob",
      lastName: "Martin",
    });
    mockAuthRepository.saveWdsfToBackend.mockRejectedValueOnce(
      new Error("Cette licence WDSF n'est pas à votre nom"),
    );

    const { result } = await renderHook(() => useLicenseLogic());
    await waitFor(() =>
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled(),
    );

    result.current.actions.handleVerifyWdsf("10117265").catch(() => {});

    await waitFor(
      () => {
        expect(result.current.state.wdsfError).toBe(
          "Cette licence WDSF n'est pas à votre nom",
        );
      },
      { timeout: 5000 },
    );
    expect(result.current.state.showWdsf).toBe(false);
    expect(mockAuthRepository.setWdsfLicenseEnabled).not.toHaveBeenCalledWith(
      true,
    );
  });

  it("should return correct list items for STAFF role", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "STAFF" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.state.role).toBe("STAFF");
    });

    const items = result.current.state.listItems;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("STAFF");
  });

  it("should return guest item when role is GUEST", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "GUEST",
      hasWdsfLicense: false,
      licensePhotoUri: null,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.state.role).toBe("GUEST");
    });

    const items = result.current.state.listItems;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("GUEST");
  });

  it("should return organizer staff card when role is CLUB", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "CLUB",
      hasWdsfLicense: false,
      licensePhotoUri: null,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.state.role).toBe("CLUB");
    });

    const items = result.current.state.listItems;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("STAFF");
  });

  it("should handle card press", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "LICENSEE" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleCardPress(1);
    });

    expect(result.current.state.activeCardIndex).toBe(1);
  });

  it("should handle show QR with valid JSON", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "LICENSEE" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleShowQr('{"key": "value"}');
    });

    expect(result.current.state.showQr).toBe(true);
    expect(result.current.state.activeQrData).toEqual({ key: "value" });
  });

  it("should handle show QR with invalid JSON", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "LICENSEE" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleShowQr("invalid json");
    });

    expect(result.current.state.showQr).toBe(true);
    expect(result.current.state.activeQrData).toBe("invalid json");
  });

  it("should remove WDSF license via confirmation", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      hasWdsfLicense: true,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.state.showWdsf).toBe(true);
    });

    await act(async () => {
      result.current.actions.handleRemoveWdsfWithConfirm();
    });

    await waitFor(() => {
      expect(mockAuthRepository.setWdsfLicenseEnabled).toHaveBeenCalledWith(
        false,
      );
    });
  });

  it("should handle add WDSF", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "LICENSEE" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleAddWdsf();
    });

    expect(result.current.state.wdsfModalVisible).toBe(true);
  });

  it("should handle load data error gracefully", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    mockAuthRepository.getAuthConfig.mockRejectedValue(
      new Error("Config error"),
    );

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    expect(result.current.state).toBeDefined();
    expect(result.current.state.role).toBe("LICENSEE");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("should handle remove WDSF with confirmation", async () => {
    const Alert = require("react-native").Alert;
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      hasWdsfLicense: true,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleRemoveWdsfWithConfirm();
    });

    expect(Alert.alert).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockAuthRepository.setWdsfLicenseEnabled).toHaveBeenCalledWith(
        false,
      );
    });
  });

  it("should handle remove WDSF with confirmation and reset callback", async () => {
    const Alert = require("react-native").Alert;
    const resetCallback = jest.fn();

    Alert.alert.mockImplementationOnce(
      (_title: string, _message?: string, buttons?: MockAlertButtons) => {
        if (buttons?.[0]?.onPress) {
          buttons[0].onPress();
        }
      },
    );

    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      hasWdsfLicense: true,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleRemoveWdsfWithConfirm(resetCallback);
    });

    expect(Alert.alert).toHaveBeenCalled();
    expect(resetCallback).toHaveBeenCalled();
  });

  it("should load profile and set ffdUser when isLoggedIn and role is LICENSEE", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      hasWdsfLicense: false,
      licensePhotoUri: null,
      isLoggedIn: true,
    });
    mockAuthRepository.getProfile.mockResolvedValue({
      firstName: "Jean",
      lastName: "Dupont",
      license: { number: "12345", validUntil: "2026-08-31" },
      clubName: "Club FFD",
      birthDate: "1990-05-15",
      role: "LICENSEE",
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getProfile).toHaveBeenCalled();
    });

    await waitFor(() => {
      const items = result.current.state.listItems;
      expect(items.length).toBeGreaterThanOrEqual(1);
      const ffdItem = items.find((i) => i.type === "FFD");
      expect(ffdItem).toBeDefined();
      expect(ffdItem?.data?.firstName).toBe("Jean");
      expect(ffdItem?.data?.lastName).toBe("Dupont");
      expect(ffdItem?.data?.licenseNumber).toBe("12345");
      // Backend sans QR signé : pas de qrCode ⇒ repli sur l'ancien contenu.
      expect(ffdItem?.data?.qrCode).toBeUndefined();
    });
  });

  describe("FFD validity never invented (#211)", () => {
    const loadFfd = async (license: Record<string, unknown> | null) => {
      mockAuthRepository.getAuthConfig.mockResolvedValue({
        role: "LICENSEE",
        hasWdsfLicense: false,
        licensePhotoUri: null,
        isLoggedIn: true,
      });
      mockAuthRepository.getProfile.mockResolvedValue({
        firstName: "Jean",
        lastName: "Dupont",
        license,
        clubName: "Club FFD",
        birthDate: "1990-05-15",
        role: "LICENSEE",
      });
      const { result } = await renderHook(() => useLicenseLogic());
      await waitFor(() => {
        expect(
          result.current.state.listItems.find((i) => i.type === "FFD"),
        ).toBeDefined();
      });
      return result.current.state.listItems.find((i) => i.type === "FFD")?.data;
    };

    it("shows a neutral status and no date nor season without validUntil", async () => {
      const ffdUser = await loadFfd({ number: "12345" });
      expect(ffdUser?.validUntil).toBe("");
      expect(ffdUser?.validUntilRaw).toBeUndefined();
      expect(ffdUser?.status).toBe("Validité non communiquée");
      expect(ffdUser?.season).toBeUndefined();
    });

    describe("with a fake clock on 10/10/2026 (season 2026/2027)", () => {
      beforeEach(() => {
        // Only Date is faked: timers stay real for waitFor / promises.
        jest.useFakeTimers({
          now: new Date(2026, 9, 10, 12, 0),
          doNotFake: [
            "nextTick",
            "setImmediate",
            "clearImmediate",
            "setTimeout",
            "clearTimeout",
            "setInterval",
            "clearInterval",
            "queueMicrotask",
            "requestAnimationFrame",
            "cancelAnimationFrame",
          ],
        });
      });
      afterEach(() => {
        jest.useRealTimers();
      });

      it("shows the current season for a valid mid-season expiry (2030-12-31)", async () => {
        const ffdUser = await loadFfd({
          number: "12345",
          validUntil: "2030-12-31T12:00:00.000Z",
        });
        expect(ffdUser?.validUntil).toBe("31/12/2030");
        expect(ffdUser?.status).toBeUndefined();
        expect(ffdUser?.season).toBe("2026/2027");
      });

      it("shows the season of the expiry date for an expired licence", async () => {
        const ffdUser = await loadFfd({
          number: "12345",
          validUntil: "2026-08-31T12:00:00.000Z",
        });
        expect(ffdUser?.validUntil).toBe("31/08/2026");
        expect(ffdUser?.season).toBe("2025/2026");
      });

      it.each(["STAFF", "CLUB"])(
        "gives the %s card the current season",
        async (role) => {
          mockAuthRepository.getAuthConfig.mockResolvedValue({ role });
          const { result } = await renderHook(() => useLicenseLogic());
          await waitFor(() => {
            expect(result.current.state.role).toBe(role);
          });
          expect(result.current.state.listItems[0].data?.season).toBe(
            "2026/2027",
          );
        },
      );
    });
  });

  describe("linked WDSF license (beta feedback)", () => {
    const loadWdsf = async (wdsf: Record<string, unknown>) => {
      mockAuthRepository.getAuthConfig.mockResolvedValue({
        role: "LICENSEE",
        hasWdsfLicense: true,
        licensePhotoUri: null,
        isLoggedIn: true,
      });
      mockAuthRepository.getProfile.mockResolvedValue({
        firstName: "Jean",
        lastName: "Dupont",
        license: { number: "12345", validUntil: "2026-08-31" },
        clubName: "Club FFD",
        birthDate: "1990-05-15",
        role: "LICENSEE",
        wdsf: { min: "10117265", nationality: "France", ...wdsf },
      });
      const { result } = await renderHook(() => useLicenseLogic());
      await waitFor(() => {
        expect(
          result.current.state.listItems.find((i) => i.type === "WDSF"),
        ).toBeDefined();
      });
      return result.current.state.listItems.find((i) => i.type === "WDSF")
        ?.data;
    };

    it("shows the national federation returned by the server, not WDSF", async () => {
      const wdsfUser = await loadWdsf({
        federation: "FFD - Fédération Française de Danse",
      });
      expect(wdsfUser?.structure).toBe("FFD - Fédération Française de Danse");
    });

    it("never invents WDSF as the federation when the server does not know it", async () => {
      const wdsfUser = await loadWdsf({ federation: null });
      expect(wdsfUser?.structure).toBeUndefined();
    });

    it("keeps the status out of the expiry date when there is none", async () => {
      const wdsfUser = await loadWdsf({ expiresOn: null });
      expect(wdsfUser?.validUntil).toBe("");
      expect(wdsfUser?.status).toBe("Active");
    });

    it("formats a real expiry date and sets no status", async () => {
      const wdsfUser = await loadWdsf({
        expiresOn: "2026-12-31T00:00:00.000Z",
      });
      expect(wdsfUser?.validUntil).toMatch(/2026/);
      expect(wdsfUser?.status).toBeUndefined();
    });
  });

  it("maps a freshly verified WDSF license without an expiry date to a status", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      authToken: "token",
      isLoggedIn: true,
    });
    mockAuthRepository.getProfile.mockResolvedValue({
      firstName: "Jean",
      lastName: "Dupont",
      role: "LICENSEE",
    });
    mockAuthRepository.verifyWdsfLicense.mockResolvedValue({
      firstName: "Jean",
      lastName: "Dupont",
      licenseNumber: "10117265",
      type: "Athlete's License",
      structure: "",
      validUntil: "Active",
      status: "Active",
      birthDate: "1990-05-15",
    });

    const { result } = await renderHook(() => useLicenseLogic());
    await waitFor(() =>
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled(),
    );
    await act(async () => {
      await result.current.actions.handleVerifyWdsf("10117265");
    });

    const wdsfUser = result.current.state.listItems.find(
      (i) => i.type === "WDSF",
    )?.data;
    expect(wdsfUser?.validUntil).toBe("");
    expect(wdsfUser?.status).toBe("Active");
    expect(wdsfUser?.structure).toBeUndefined();
  });

  describe("STAFF / CLUB account card (#234)", () => {
    const loadAccountCard = async (
      role: "STAFF" | "CLUB",
      profile: Record<string, unknown> | null,
      config: Record<string, unknown> = {},
    ) => {
      mockAuthRepository.getAuthConfig.mockResolvedValue({
        role,
        isLoggedIn: true,
        username: "account@test.com",
        ...config,
      });
      if (profile) {
        mockAuthRepository.getProfile.mockResolvedValue(profile);
      } else {
        mockAuthRepository.getProfile.mockRejectedValue(new Error("boom"));
      }
      const { result } = await renderHook(() => useLicenseLogic());
      await waitFor(() => {
        expect(mockAuthRepository.getProfile).toHaveBeenCalled();
      });
      return result;
    };

    it("STAFF card carries the profile's name and club, no demo value", async () => {
      const result = await loadAccountCard("STAFF", {
        firstName: "Marie",
        lastName: "Curie",
        role: "STAFF",
        clubName: "Club de Danse Lyon",
        birthDate: "1990-05-15",
      });
      await waitFor(() => {
        expect(result.current.state.listItems[0].data?.lastName).toBe("Curie");
      });
      const card = result.current.state.listItems[0];
      expect(card.type).toBe("STAFF");
      expect(card.data).toMatchObject({
        firstName: "Marie",
        lastName: "Curie",
        structure: "Club de Danse Lyon",
        licenseNumber: "",
        type: "STAFF / ORGANISATEUR",
      });
      expect(card.data?.birthDate).toBe(
        new Date("1990-05-15").toLocaleDateString("fr-FR"),
      );
      const serialized = JSON.stringify(card.data);
      expect(serialized).not.toMatch(
        /OFFICIEL|STAFF-001|Fédération Française de Danse/,
      );
    });

    it("CLUB card carries the account's club name", async () => {
      const result = await loadAccountCard("CLUB", {
        firstName: "Jean",
        lastName: "Gérant",
        role: "CLUB",
        clubName: "Danse Passion Nantes",
      });
      await waitFor(() => {
        expect(result.current.state.listItems[0].data?.lastName).toBe(
          "Danse Passion Nantes",
        );
      });
      const card = result.current.state.listItems[0].data;
      expect(card).toMatchObject({
        firstName: "",
        licenseNumber: "",
        birthDate: "",
        type: "CLUB / ASSOCIATION",
      });
      expect(card?.structure).toBeUndefined();
      expect(JSON.stringify(card)).not.toMatch(
        /EXAMPLE|CLUB-001|Fédération Française de Danse/,
      );
    });

    it("CLUB card falls back to the session club name when the profile fails", async () => {
      const result = await loadAccountCard("CLUB", null, {
        clubName: "Club Session",
      });
      await waitFor(() => {
        expect(result.current.state.listItems[0].data?.lastName).toBe(
          "Club Session",
        );
      });
    });

    it.each([
      ["STAFF", ACCOUNT_NAME_UNKNOWN],
      ["CLUB", ACCOUNT_CLUB_UNKNOWN],
    ] as const)(
      "%s card shows a neutral label when the data is missing",
      async (role, label) => {
        const result = await loadAccountCard(role, {
          firstName: "",
          lastName: "",
          role,
        });
        await waitFor(() => {
          expect(result.current.state.listItems[0].data?.lastName).toBe(label);
        });
        expect(result.current.state.listItems[0].data).toMatchObject({
          firstName: "",
          licenseNumber: "",
        });
        expect(
          result.current.state.listItems[0].data?.structure,
        ).toBeUndefined();
      },
    );

    it("STAFF card offline uses the account's own snapshot name", async () => {
      mockIsDeviceOffline.mockResolvedValueOnce(true);
      mockLoadSnapshot.mockResolvedValueOnce({
        ffdUser: {
          firstName: "Marie",
          lastName: "Curie",
          licenseNumber: "Non renseigné",
          birthDate: "",
          validUntil: "",
          type: "Athlète",
        },
        wdsfUser: null,
        savedAt: "2026-10-01T10:00:00.000Z",
      });
      mockAuthRepository.getAuthConfig.mockResolvedValue({
        role: "STAFF",
        isLoggedIn: true,
        username: "staff@test.com",
      });
      const { result } = await renderHook(() => useLicenseLogic());
      await waitFor(() => {
        expect(result.current.state.listItems[0].data?.lastName).toBe("Curie");
      });
      expect(result.current.state.listItems[0].data?.firstName).toBe("Marie");
      expect(result.current.state.listItems[0].data?.licenseNumber).toBe("");
    });
  });

  it("gives the staff and club cards a status, not a fake expiry date", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "STAFF" });
    const staff = await renderHook(() => useLicenseLogic());
    await waitFor(() => {
      expect(staff.result.current.state.role).toBe("STAFF");
    });
    expect(staff.result.current.state.listItems[0].data).toMatchObject({
      validUntil: "",
      status: "Permanente",
    });

    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "CLUB" });
    const club = await renderHook(() => useLicenseLogic());
    await waitFor(() => {
      expect(club.result.current.state.role).toBe("CLUB");
    });
    expect(club.result.current.state.listItems[0].data).toMatchObject({
      validUntil: "",
      status: "Active",
    });
  });

  it("keeps the server-signed QR on the FFD license (#168)", async () => {
    const qrCode = '{"v":1,"id":"FFD-12345","exp":"2026-08-31","sig":"abc"}';
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      hasWdsfLicense: false,
      licensePhotoUri: null,
      isLoggedIn: true,
    });
    mockAuthRepository.getProfile.mockResolvedValue({
      firstName: "Jean",
      lastName: "Dupont",
      license: { number: "FFD-12345", validUntil: "2026-08-31", qrCode },
      clubName: "Club FFD",
      birthDate: "1990-05-15",
      role: "LICENSEE",
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      const ffdItem = result.current.state.listItems.find(
        (i) => i.type === "FFD",
      );
      expect(ffdItem?.data?.qrCode).toBe(qrCode);
    });
  });

  describe("hors ligne (#416)", () => {
    const snapshot = {
      savedAt: "2026-10-01T10:00:00.000Z",
      ffdUser: {
        firstName: "Jean",
        lastName: "Dupont",
        licenseNumber: "12345",
        type: "Athlète",
        structure: "Club FFD",
        validUntil: "31/08/2026",
        season: "2025/2026",
        birthDate: "15/05/1990",
      },
      wdsfUser: null,
    };

    beforeEach(() => {
      mockAuthRepository.getAuthConfig.mockResolvedValue({
        role: "LICENSEE",
        hasWdsfLicense: true,
        licensePhotoUri: null,
        isLoggedIn: true,
        username: "alice@ffd.fr",
      });
    });

    const profile = {
      firstName: "Jean",
      lastName: "Dupont",
      license: { number: "12345", validUntil: "2026-08-31" },
      clubName: "Club FFD",
      birthDate: "1990-05-15",
      role: "LICENSEE",
    };

    const networkError = () =>
      new AxiosError("Network Error", "ERR_NETWORK", {
        headers: new AxiosHeaders(),
      });

    const serverError = () =>
      new AxiosError(
        "Request failed with status code 500",
        "ERR_BAD_RESPONSE",
        { headers: new AxiosHeaders() },
        null,
        {
          status: 500,
          statusText: "Internal Server Error",
          headers: {},
          config: { headers: new AxiosHeaders() },
          data: {},
        },
      );

    afterEach(() => {
      mockIsDeviceOffline.mockImplementation(() => Promise.resolve(false));
      mockLoadSnapshot.mockImplementation(() => Promise.resolve(null));
    });

    it("serves the snapshot at once when offline, without waiting for the network", async () => {
      mockIsDeviceOffline.mockResolvedValue(true);
      mockLoadSnapshot.mockResolvedValue(snapshot);

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(
          result.current.state.listItems.find((i) => i.type === "FFD")?.data
            ?.licenseNumber,
        ).toBe("12345");
      });
      expect(result.current.state.offlineSince).toBe(snapshot.savedAt);
      expect(result.current.state.licenseUnavailable).toBe(false);
      expect(mockAuthRepository.getProfile).not.toHaveBeenCalled();
      // Only the current account's snapshot is asked for.
      expect(mockLoadSnapshot).toHaveBeenCalledWith("alice@ffd.fr");
    });

    it("drops the invented date of an older snapshot without raw date (#211)", async () => {
      mockIsDeviceOffline.mockResolvedValue(true);
      mockLoadSnapshot.mockResolvedValue(snapshot);

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(
          result.current.state.listItems.find((i) => i.type === "FFD"),
        ).toBeDefined();
      });
      const ffdUser = result.current.state.listItems.find(
        (i) => i.type === "FFD",
      )?.data;
      expect(ffdUser?.validUntil).toBe("");
      expect(ffdUser?.status).toBe("Validité non communiquée");
      expect(ffdUser?.season).toBeUndefined();
    });

    it("re-derives date and season from the snapshot's raw date", async () => {
      mockIsDeviceOffline.mockResolvedValue(true);
      mockLoadSnapshot.mockResolvedValue({
        ...snapshot,
        ffdUser: {
          ...snapshot.ffdUser,
          // Expired: its season does not depend on today's date.
          validUntilRaw: "2026-08-31T12:00:00.000Z",
        },
      });

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(
          result.current.state.listItems.find((i) => i.type === "FFD")?.data
            ?.validUntil,
        ).toBe("31/08/2026");
      });
      expect(
        result.current.state.listItems.find((i) => i.type === "FFD")?.data
          ?.season,
      ).toBe("2025/2026");
    });

    it("shows nothing when no snapshot belongs to the current account", async () => {
      // A's snapshot on the device, C logged in: the (real) loader answers
      // null for a foreign owner — the hook must fall to the unavailable state.
      mockIsDeviceOffline.mockResolvedValue(true);
      mockLoadSnapshot.mockImplementation((owner) =>
        Promise.resolve(owner === "alice@ffd.fr" ? snapshot : null),
      );
      mockAuthRepository.getAuthConfig.mockResolvedValue({
        role: "LICENSEE",
        hasWdsfLicense: false,
        isLoggedIn: true,
        username: "charlie@ffd.fr",
      });

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(result.current.state.licenseUnavailable).toBe(true);
      });
      expect(mockLoadSnapshot).toHaveBeenCalledWith("charlie@ffd.fr");
      expect(result.current.state.offlineSince).toBeNull();
      expect(result.current.state.listItems).toEqual([]);
    });

    describe("while impersonating", () => {
      beforeEach(() => {
        mockAuthRepository.getAuthConfig.mockResolvedValue({
          role: "LICENSEE",
          hasWdsfLicense: false,
          isLoggedIn: true,
          username: "bob@ffd.fr",
          impersonating: true,
        });
        mockLoadSnapshot.mockResolvedValue(snapshot);
      });

      it("never serves a snapshot offline", async () => {
        mockIsDeviceOffline.mockResolvedValue(true);

        const { result } = await renderHook(() => useLicenseLogic());

        await waitFor(() => {
          expect(result.current.state.licenseUnavailable).toBe(true);
        });
        expect(mockLoadSnapshot).not.toHaveBeenCalled();
        expect(result.current.state.offlineSince).toBeNull();
      });

      it("never serves a snapshot when the profile request fails", async () => {
        mockAuthRepository.getProfile.mockRejectedValueOnce(networkError());

        const { result } = await renderHook(() => useLicenseLogic());

        await waitFor(() => {
          expect(result.current.state.licenseUnavailable).toBe(true);
        });
        expect(mockLoadSnapshot).not.toHaveBeenCalled();
      });

      it("never saves a snapshot after a successful load", async () => {
        mockAuthRepository.getProfile.mockResolvedValue(profile);

        const { result } = await renderHook(() => useLicenseLogic());

        await waitFor(() => {
          expect(
            result.current.state.listItems.find((i) => i.type === "FFD"),
          ).toBeDefined();
        });
        expect(saveLicenseSnapshot).not.toHaveBeenCalled();
      });
    });

    it("uses the offline wording when the request fails on a network error", async () => {
      mockAuthRepository.getProfile.mockRejectedValueOnce(networkError());

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(result.current.state.licenseUnavailableReason).toBe("offline");
      });
      expect(result.current.state.licenseUnavailable).toBe(true);
    });

    it("uses the neutral wording when the request fails online (5xx)", async () => {
      mockAuthRepository.getProfile.mockRejectedValueOnce(serverError());

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(result.current.state.licenseUnavailableReason).toBe("error");
      });
      expect(result.current.state.licenseUnavailable).toBe(true);
    });

    it("uses the offline wording when NetInfo reports offline after a failure", async () => {
      // Online at first check, the request then fails without being an axios
      // network error; NetInfo now confirms the device is offline.
      mockIsDeviceOffline
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockAuthRepository.getProfile.mockRejectedValueOnce(new Error("boom"));

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(result.current.state.licenseUnavailableReason).toBe("offline");
      });
    });

    it("does not offer the pull-to-add WDSF card when the license is unavailable", async () => {
      mockIsDeviceOffline.mockResolvedValue(true);
      mockAuthRepository.getAuthConfig.mockResolvedValue({
        role: "LICENSEE",
        hasWdsfLicense: false,
        isLoggedIn: true,
        username: "alice@ffd.fr",
      });

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(result.current.state.licenseUnavailable).toBe(true);
      });
      expect(
        result.current.state.listItems.find((i) => i.type === "ADD_WDSF"),
      ).toBeUndefined();
    });

    it("flags the license as unavailable when offline without a snapshot", async () => {
      mockIsDeviceOffline.mockResolvedValue(true);

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(result.current.state.licenseUnavailable).toBe(true);
      });
      expect(
        result.current.state.listItems.find((i) => i.type === "FFD"),
      ).toBeUndefined();
    });

    it("falls back to the snapshot when the profile request fails", async () => {
      mockAuthRepository.getProfile.mockRejectedValueOnce(
        new Error("Network Error"),
      );
      mockLoadSnapshot.mockResolvedValue(snapshot);

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(result.current.state.offlineSince).toBe(snapshot.savedAt);
      });
      expect(result.current.state.licenseUnavailable).toBe(false);
    });

    it("clears the unavailable flag and saves a snapshot once online", async () => {
      mockAuthRepository.getProfile.mockResolvedValue({
        firstName: "Jean",
        lastName: "Dupont",
        license: { number: "12345", validUntil: "2026-08-31" },
        clubName: "Club FFD",
        birthDate: "1990-05-15",
        role: "LICENSEE",
      });

      const { result } = await renderHook(() => useLicenseLogic());

      await waitFor(() => {
        expect(saveLicenseSnapshot).toHaveBeenCalled();
      });
      expect(saveLicenseSnapshot).toHaveBeenCalledWith(
        "alice@ffd.fr",
        expect.objectContaining({ licenseNumber: "12345" }),
        expect.objectContaining({ licenseNumber: "WDSF-PENDING" }),
      );
      expect(result.current.state.licenseUnavailable).toBe(false);
      expect(result.current.state.offlineSince).toBeNull();
    });
  });
});
