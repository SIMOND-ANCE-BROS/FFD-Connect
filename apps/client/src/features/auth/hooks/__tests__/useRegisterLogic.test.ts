import { act, renderHook } from "@testing-library/react-native";
import { Alert } from "react-native";
import * as AuthContext from "../../context/AuthContext";
import { useRegisterLogic } from "../useRegisterLogic";

jest.mock("../../context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));
jest.mock("react-native", () => ({
  Alert: { alert: jest.fn() },
  Platform: { OS: "ios" },
}));
const mockRefreshAuth = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../../stores/auth.store", () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ refreshAuth: mockRefreshAuth }),
}));
jest.mock("../../../legal/cguConsent", () => ({
  acceptCgu: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../../services/analytics", () => ({
  analytics: { logEvent: jest.fn() },
}));

/** A licence number encoding a birth date: a minor for the next few years. */
const MINOR_LICENSE = `${new Date().getUTCFullYear() - 12}0301-mar-le01`;
const ADULT_LICENSE = "19900101-dup-ga42";

describe("useRegisterLogic — parental consent (#61)", () => {
  const register = jest.fn().mockResolvedValue(undefined);
  const navigation = { navigate: jest.fn() } as unknown as Parameters<
    typeof useRegisterLogic
  >[0]["navigation"];

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthContext.useAuthRepository as jest.Mock).mockReturnValue({
      register,
    });
  });

  async function fill(licenseNumber: string, parentEmail?: string) {
    const hook = await renderHook(() => useRegisterLogic({ navigation }));
    await act(async () => {
      hook.result.current.actions.setEmail("lea@example.fr");
      hook.result.current.actions.setPassword("Secret123!");
      hook.result.current.actions.setConfirmPassword("Secret123!");
      hook.result.current.actions.setLicenseNumber(licenseNumber);
      hook.result.current.actions.setLastName("Martin");
      hook.result.current.actions.setFirstName("Léa");
      hook.result.current.actions.toggleCguAccepted();
      if (parentEmail !== undefined) {
        hook.result.current.actions.setParentEmail(parentEmail);
      }
    });
    return hook;
  }

  it("asks a minor for a parent's address", async () => {
    const { result } = await fill(MINOR_LICENSE);
    expect(result.current.state.isMinor).toBe(true);

    await act(async () => result.current.actions.onRegister());

    expect(register).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Accord parental",
      expect.stringContaining("mineur(e)"),
    );
  });

  it("refuses the minor's own address as the parent's", async () => {
    const { result } = await fill(MINOR_LICENSE, " LEA@example.fr ");

    await act(async () => result.current.actions.onRegister());

    expect(register).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Accord parental",
      expect.stringContaining("différente"),
    );
  });

  it("sends the parent's address with a minor's registration", async () => {
    const { result } = await fill(MINOR_LICENSE, " parent@example.fr ");

    await act(async () => result.current.actions.onRegister());

    expect(register).toHaveBeenCalledWith(
      "lea@example.fr",
      "Secret123!",
      MINOR_LICENSE,
      "Martin",
      "Léa",
      "parent@example.fr",
    );
  });

  it("never asks an adult, and sends no parent address", async () => {
    const { result } = await fill(ADULT_LICENSE, "parent@example.fr");
    expect(result.current.state.isMinor).toBe(false);

    await act(async () => result.current.actions.onRegister());

    expect(register).toHaveBeenCalledWith(
      "lea@example.fr",
      "Secret123!",
      ADULT_LICENSE,
      "Martin",
      "Léa",
      undefined,
    );
  });
});
