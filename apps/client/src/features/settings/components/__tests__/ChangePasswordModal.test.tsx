import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { useTheme, ThemeContextType } from "../../../../context/ThemeContext";
import { AuthService } from "../../../auth/services/AuthService";
import { ChangePasswordModal } from "../ChangePasswordModal";

jest.mock("../../../../context/ThemeContext");
jest.mock("../../../auth/services/AuthService", () => ({
  AuthService: { changePassword: jest.fn() },
}));
jest.mock("lucide-react-native", () => ({
  Eye: () => null,
  EyeOff: () => null,
  Lock: () => null,
}));
jest.mock("../../../../components/AppButton");
jest.mock("../../../../components/AppText");

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;
const mockChangePassword = AuthService.changePassword as jest.MockedFunction<
  typeof AuthService.changePassword
>;

const theme = {
  background: "#fff",
  surface: "#f7f7f7",
  text: "#111",
  textSecondary: "#666",
  border: "#e0e0e0",
  primary: "#004481",
};

describe("ChangePasswordModal", () => {
  const onClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTheme.mockReturnValue({ theme } as unknown as ThemeContextType);
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  async function renderModal(visible = true) {
    return await render(
      <ChangePasswordModal visible={visible} onClose={onClose} />,
    );
  }

  async function fillForm(
    utils: Awaited<Awaited<ReturnType<typeof render>>>,
    current: string,
    newPwd: string,
    confirm: string,
  ) {
    await fireEvent.changeText(
      utils.getByPlaceholderText("Mot de passe actuel"),
      current,
    );
    await fireEvent.changeText(
      utils.getByPlaceholderText("Nouveau mot de passe"),
      newPwd,
    );
    await fireEvent.changeText(
      utils.getByPlaceholderText("Confirmer le nouveau mot de passe"),
      confirm,
    );
  }

  it("renders the title when visible", async () => {
    const { getAllByText } = await renderModal();
    expect(getAllByText("Changer le mot de passe").length).toBeGreaterThan(0);
  });

  it("calls onClose when close button is pressed", async () => {
    const { getByText } = await renderModal();
    await fireEvent.press(getByText("✕"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error alert when fields are empty", async () => {
    const utils = await renderModal();
    await act(async () => {
      await fireEvent.press(utils.getByTestId("btn-Changer le mot de passe"));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      expect.stringMatching(/remplir/i),
    );
  });

  it("shows error when passwords do not match", async () => {
    const utils = await renderModal();
    await fillForm(utils, "OldPass1@", "NewPass1@", "Different1@");
    await act(async () => {
      await fireEvent.press(utils.getByTestId("btn-Changer le mot de passe"));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      expect.stringMatching(/correspondent pas/i),
    );
  });

  it("shows error when new password equals current password", async () => {
    const utils = await renderModal();
    await fillForm(utils, "SamePass1@", "SamePass1@", "SamePass1@");
    await act(async () => {
      await fireEvent.press(utils.getByTestId("btn-Changer le mot de passe"));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      expect.stringMatching(/différent/i),
    );
  });

  it("shows validation error when new password is too weak", async () => {
    const utils = await renderModal();
    await fillForm(utils, "OldPass1@", "weakpass", "weakpass");
    await act(async () => {
      await fireEvent.press(utils.getByTestId("btn-Changer le mot de passe"));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Mot de passe invalide",
      expect.any(String),
    );
  });

  it("calls AuthService.changePassword with correct args on valid submit", async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const utils = await renderModal();
    await fillForm(utils, "OldPass1@", "NewStr0ng@", "NewStr0ng@");
    await act(async () => {
      await fireEvent.press(utils.getByTestId("btn-Changer le mot de passe"));
    });
    expect(mockChangePassword).toHaveBeenCalledWith("OldPass1@", "NewStr0ng@");
  });

  it("shows success alert after successful password change", async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const utils = await renderModal();
    await fillForm(utils, "OldPass1@", "NewStr0ng@", "NewStr0ng@");
    await act(async () => {
      await fireEvent.press(utils.getByTestId("btn-Changer le mot de passe"));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Succès",
      expect.stringMatching(/modifié/i),
      expect.any(Array),
    );
  });

  it("shows error alert when AuthService.changePassword throws", async () => {
    mockChangePassword.mockRejectedValue(new Error("Mot de passe incorrect"));
    const utils = await renderModal();
    await fillForm(utils, "OldPass1@", "NewStr0ng@", "NewStr0ng@");
    await act(async () => {
      await fireEvent.press(utils.getByTestId("btn-Changer le mot de passe"));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      "Mot de passe incorrect",
    );
  });
});
