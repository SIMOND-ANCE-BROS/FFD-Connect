import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { ThemeContext } from "../../../../context/ThemeContext";
import { LicenseCard, LicenseUser } from "../LicenseCard";
import { BigBarcode } from "../BigBarcode";
import { LICENSE_CARD_TEXT_MAX_SCALE } from "../license-card/license-card.config";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// Screen-reader contract of the licence card (RGAA, issue #22).

const themeMock = {
  theme: {
    surface: "#ffffff",
    text: "#000000",
    textSecondary: "#666666",
    border: "#eeeeee",
    colors: { ffdBlue: "#004fe3" },
  },
  isDark: false,
};

preloadReactNative("TouchableOpacity", "Text");

const user: LicenseUser = {
  firstName: "Jeanne",
  lastName: "Martin",
  birthDate: "2001-04-12",
  licenseNumber: "FFD-2025-12345",
  validUntil: "2026-08-31",
  type: "LICENCE D",
  status: "Active",
};

const renderCard = (props: Partial<React.ComponentProps<typeof LicenseCard>>) =>
  render(
    <ThemeContext.Provider value={themeMock as never}>
      <LicenseCard type="FFD" user={user} photoUri={null} {...props} />
    </ThemeContext.Provider>,
  );

describe("LicenseCard accessibility", () => {
  it("names the QR thumbnail button and opens the QR code", async () => {
    const onShowQr = jest.fn();
    const { getByRole } = await renderCard({ onShowQr });
    const qr = getByRole("button", {
      name: "Afficher le QR code de la licence",
    });
    expect(qr.props.testID).toBe("license-card-show-qr");
    await fireEvent.press(qr);
    expect(onShowQr).toHaveBeenCalled();
  });

  it("names the WDSF barcode button", async () => {
    const { getByRole } = await renderCard({
      type: "WDSF",
      onShowQr: jest.fn(),
    });
    expect(
      getByRole("button", { name: "Afficher le code-barres de la licence" }),
    ).toBeTruthy();
  });

  it("reads each identity field as label + value in one stop", async () => {
    const { getByText } = await renderCard({});
    // The value's parent cell is the accessible element (merged reading).
    const value = getByText("FFD-2025-12345");
    let node = value.parent;
    while (node && node.props.accessible !== true) node = node.parent;
    expect(node).not.toBeNull();
    expect(node?.props.accessible).toBe(true);
  });

  it("names the options button when present", async () => {
    const onOptions = jest.fn();
    const { getByRole } = await renderCard({
      type: "WDSF",
      onOptions,
      onShowQr: jest.fn(),
    });
    await fireEvent.press(
      getByRole("button", { name: "Options de la licence" }),
    );
    expect(onOptions).toHaveBeenCalled();
  });
});

describe("BigBarcode accessibility", () => {
  it("speaks the licence number instead of the drawn bars", async () => {
    const { getByRole } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <BigBarcode value="MIN-10001" />
      </ThemeContext.Provider>,
    );
    expect(
      getByRole("image", {
        name: "Code-barres de la licence, numéro MIN-10001",
      }),
    ).toBeTruthy();
  });

  it("caps the text scale only on the fixed-size card cells (large text)", async () => {
    const { getByText } = await renderCard({});
    expect(getByText("LICENCE D").props.maxFontSizeMultiplier).toBe(
      LICENSE_CARD_TEXT_MAX_SCALE,
    );
    expect(getByText("FFD-2025-12345").props.maxFontSizeMultiplier).toBe(
      LICENSE_CARD_TEXT_MAX_SCALE,
    );
  });
});
