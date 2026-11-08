import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { expectSiblingBackdrop } from "../../../../__tests__/mocks/modalA11y";
import { DeleteAccountModal } from "../DeleteAccountModal";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";
import { deleteMyAccount } from "../../services/PrivacyService";

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      background: "#fafafa",
      text: "#111",
      textSecondary: "#666",
      border: "#ddd",
    },
    isDark: false,
  }),
}));
jest.mock("../../services/PrivacyService", () => ({
  deleteMyAccount: jest.fn(),
}));

// One-off react-native module loading, out of the first test's budget
// (flaky under load otherwise, #546).
preloadReactNative("Modal", "TextInput");

describe("DeleteAccountModal", () => {
  const onClose = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it("a11y (#356): backdrop is an announced close button, sibling of the form", async () => {
    const { getByTestId } = await render(
      <DeleteAccountModal visible onClose={onClose} onDeleted={jest.fn()} />,
    );

    expectSiblingBackdrop(
      getByTestId("delete-account-backdrop"),
      getByTestId("delete-account-card"),
    );
    expect(getByTestId("delete-account-password-input")).toBeTruthy();

    await fireEvent.press(getByTestId("delete-account-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("a failed deletion (#935)", () => {
    const submit = async (error: Error) => {
      (deleteMyAccount as jest.Mock).mockRejectedValue(error);
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      const onDeleted = jest.fn();
      const { getByTestId } = await render(
        <DeleteAccountModal visible onClose={onClose} onDeleted={onDeleted} />,
      );
      await fireEvent.changeText(
        getByTestId("delete-account-password-input"),
        "s3cret",
      );
      await fireEvent.press(getByTestId("delete-account-confirm-button"));
      await waitFor(() => expect(alert).toHaveBeenCalled());
      expect(onDeleted).not.toHaveBeenCalled();
      return alert.mock.calls[0][1];
    };

    it("says the password is wrong", async () => {
      await expect(submit(new Error("WRONG_PASSWORD"))).resolves.toBe(
        "Mot de passe incorrect.",
      );
    });

    it("does not claim a deletion it could not confirm has failed", async () => {
      // The response may be lost after the server deleted the account: the
      // app then signs out by itself at its next request.
      const message = await submit(new Error("Network Error"));

      expect(message).not.toMatch(/a échoué/);
      expect(message).toMatch(/pas pu être confirmée/);
      expect(message).toMatch(/déconnecté/);
    });
  });
});
