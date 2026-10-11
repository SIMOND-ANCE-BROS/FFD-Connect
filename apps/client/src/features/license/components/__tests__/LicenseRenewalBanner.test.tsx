import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { useRenewalPending } from "../../hooks/useRenewalPending";
import { LicenseRenewalBanner } from "../LicenseRenewalBanner";

jest.mock("../../hooks/useRenewalPending", () => ({
  useRenewalPending: jest.fn(),
}));
jest.mock("../LicenseExpiryBanner", () => ({
  LicenseExpiryBanner: () => {
    const { Text } = require("react-native");
    return <Text>expiry-banner</Text>;
  },
}));
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { primary: "#004481", textSecondary: "#666" },
  }),
}));

const mockPending = useRenewalPending as jest.Mock;

describe("LicenseRenewalBanner (#268)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("says the request is being checked while it is PENDING", async () => {
    mockPending.mockReturnValue(true);
    const onPress = jest.fn();

    const { getByText, queryByText, getByRole } = await render(
      <LicenseRenewalBanner validUntil="2026-08-31" onPress={onPress} />,
    );

    expect(
      getByText("Demande de renouvellement en cours de vérification"),
    ).toBeTruthy();
    // Never "renew now" next to a request already submitted.
    expect(queryByText("expiry-banner")).toBeNull();

    await fireEvent.press(getByRole("button"));
    expect(onPress).toHaveBeenCalled();
  });

  it("falls back to the expiry banner otherwise", async () => {
    mockPending.mockReturnValue(false);

    const { getByText, queryByText } = await render(
      <LicenseRenewalBanner validUntil="2026-08-31" onPress={jest.fn()} />,
    );

    expect(getByText("expiry-banner")).toBeTruthy();
    expect(queryByText(/en cours de vérification/)).toBeNull();
  });
});
