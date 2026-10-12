import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { expectSiblingBackdrop } from "../../../../__tests__/mocks/modalA11y";
import { DeleteAccountModal } from "../DeleteAccountModal";

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
});
