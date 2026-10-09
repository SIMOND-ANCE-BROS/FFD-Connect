import { render, within } from "@testing-library/react-native";
import React from "react";
import { StyleSheet } from "react-native";
import { ThemeContext } from "../../../../context/ThemeContext";
import { LicenseCard, LicenseUser } from "../LicenseCard";

const themeMock = {
  theme: {
    surface: "#ffffff",
    text: "#000000",
    textSecondary: "#666666",
    border: "#eeeeee",
    colors: { ffdBlue: "#004fe3" },
    typography: {
      fontFamily: "System",
      h1: { fontSize: 32, fontFamily: "System" },
      h2: { fontSize: 24, fontFamily: "System" },
      h3: { fontSize: 18, fontFamily: "System" },
      body: { fontSize: 14, fontFamily: "System" },
      caption: { fontSize: 12, fontFamily: "System" },
    },
  },
  dark: false,
  toggleTheme: jest.fn(),
  isDark: false,
};

describe("LicenseCard", () => {
  const mockUser: LicenseUser = {
    firstName: "John",
    lastName: "Doe",
    birthDate: "1990-01-01",
    licenseNumber: "12345678",
    validUntil: "2026-08-31",
    type: "LICENCE D",
    status: "Active",
  };

  const mockOnShowQr = jest.fn();

  it("renders correctly for FFD", async () => {
    const { getByText, getAllByText } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <LicenseCard
          type="FFD"
          user={mockUser}
          photoUri={null}
          onShowQr={mockOnShowQr}
        />
      </ThemeContext.Provider>,
    );

    expect(getByText("John Doe")).toBeTruthy();
    // Using getAllByText because it might appear twice (info and barcode/QR label)
    expect(getAllByText("12345678").length).toBeGreaterThanOrEqual(1);
  });

  it("puts the FFD birth date right under the licence number", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <LicenseCard
          type="FFD"
          user={mockUser}
          photoUri={null}
          onShowQr={mockOnShowQr}
        />
      </ThemeContext.Provider>,
    );

    // Same column, next row: number then birth date, in this order.
    const column = getByTestId("license-card-identity-column-0");
    const texts = within(column)
      .getAllByText(/.+/)
      .map((node) => node.props.children as string);
    expect(texts).toEqual([
      "Numéro",
      "12345678",
      "Date de naissance",
      "1990-01-01",
    ]);
    expect(queryByTestId("license-card-identity-column-1")).toBeNull();
  });

  it("extra FFD fields go to a second column — puts the FFD birth date right under the licence number", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <LicenseCard
          type="FFD"
          user={{ ...mockUser, country: "FRA", ageGroup: "Adult" }}
          photoUri={null}
          onShowQr={mockOnShowQr}
        />
      </ThemeContext.Provider>,
    );

    expect(
      within(getByTestId("license-card-identity-column-1")).getByText("FRA"),
    ).toBeTruthy();
    expect(
      within(getByTestId("license-card-identity-column-0")).getByText(
        "1990-01-01",
      ),
    ).toBeTruthy();
    expect(queryByTestId("license-card-identity-column-1")).not.toBeNull();
  });

  it("renders correctly for WDSF", async () => {
    const { getByText, getAllByText } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <LicenseCard
          type="WDSF"
          user={mockUser}
          photoUri={null}
          onShowQr={mockOnShowQr}
        />
      </ThemeContext.Provider>,
    );

    expect(getByText("John Doe")).toBeTruthy();
    expect(getAllByText("12345678").length).toBeGreaterThanOrEqual(1);
  });
  it("shows every WDSF field in the compact layout", async () => {
    const { getByText } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <LicenseCard
          type="WDSF"
          user={{
            ...mockUser,
            country: "FRA",
            ageGroup: "Adult",
            partnerName: "Jane Roe",
            partnerAgeGroup: "Adult",
            structure: "FFD",
            administrator: "DTN",
          }}
          photoUri={null}
          onShowQr={mockOnShowQr}
          onOptions={jest.fn()}
        />
      </ThemeContext.Provider>,
    );

    expect(getByText("Nationality")).toBeTruthy();
    expect(getByText("FRA")).toBeTruthy();
    expect(getByText("Age group")).toBeTruthy();
    expect(getByText("My partner")).toBeTruthy();
    expect(getByText("Jane Roe")).toBeTruthy();
    expect(getByText("My federation")).toBeTruthy();
    expect(getByText("DTN")).toBeTruthy();
    expect(getByText("License expires on")).toBeTruthy();
    expect(getByText("2026-08-31")).toBeTruthy();
    expect(getByText("Contact my federation")).toBeTruthy();
  });

  it("shows FFD structure, insurance and validity", async () => {
    const { getByText } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <LicenseCard
          type="FFD"
          user={{ ...mockUser, structure: "Club A", insurance: "MAIF" }}
          photoUri={null}
          onShowQr={mockOnShowQr}
        />
      </ThemeContext.Provider>,
    );

    expect(getByText("Club A")).toBeTruthy();
    expect(getByText("MAIF")).toBeTruthy();
    expect(getByText("Licence valable jusqu'au")).toBeTruthy();
  });

  describe("beta feedback", () => {
    const renderCard = (
      type: "FFD" | "WDSF",
      user: Partial<LicenseUser> = {},
      themeOverride?: "light" | "dark",
    ) =>
      render(
        <ThemeContext.Provider value={themeMock as never}>
          <LicenseCard
            type={type}
            user={{ ...mockUser, ...user }}
            photoUri={null}
            onShowQr={mockOnShowQr}
            themeOverride={themeOverride}
          />
        </ThemeContext.Provider>,
      );

    it("never truncates the birth date label with an ellipsis", async () => {
      const { getByText } = await renderCard("FFD");

      // numberOfLines={1} cut it to « Date de naissa… » on a phone.
      expect(
        getByText("Date de naissance").props.numberOfLines,
      ).toBeUndefined();
      expect(getByText("Numéro").props.numberOfLines).toBeUndefined();
    });

    it("gives the lone FFD identity column the whole width", async () => {
      const { getByTestId } = await renderCard("FFD");

      const style = StyleSheet.flatten(
        getByTestId("license-card-identity-column-0").props.style as object,
      ) as { width?: string; flex?: number };
      // It was 50% wide even without a second column.
      expect(style.width).toBeUndefined();
      expect(style.flex).toBe(1);
    });

    it("never truncates the WDSF grid labels either", async () => {
      const { getByText } = await renderCard("WDSF", { ageGroup: "Adult" });

      expect(getByText("Date of birth").props.numberOfLines).toBeUndefined();
      expect(getByText("Age group").props.numberOfLines).toBeUndefined();
    });

    it("labels a WDSF status as a status, not as an expiry date", async () => {
      const { getByText, queryByText } = await renderCard("WDSF", {
        validUntil: "",
        status: "Active",
      });

      expect(getByText("License status")).toBeTruthy();
      expect(getByText("Active")).toBeTruthy();
      expect(queryByText("License expires on")).toBeNull();
    });

    it("labels a permanent FFD card as a status", async () => {
      const { getByText, queryByText } = await renderCard("FFD", {
        validUntil: "",
        status: "Permanente",
      });

      expect(getByText("Statut de la licence")).toBeTruthy();
      expect(getByText("Permanente")).toBeTruthy();
      expect(queryByText("Licence valable jusqu'au")).toBeNull();
    });

    it("shows the national federation on the WDSF card", async () => {
      const { getByText } = await renderCard("WDSF", {
        structure: "FFD - Fédération Française de Danse",
      });

      expect(getByText("My federation")).toBeTruthy();
      expect(getByText("FFD - Fédération Française de Danse")).toBeTruthy();
    });

    it("hides the federation when it is unknown instead of showing WDSF", async () => {
      const { queryByText } = await renderCard("WDSF", {
        structure: undefined,
      });

      expect(queryByText("My federation")).toBeNull();
    });

    it("keeps the WDSF header title readable on the light theme", async () => {
      const { getByText } = await renderCard("WDSF", {}, "light");

      const style = StyleSheet.flatten(
        getByText("LICENCE D").props.style as object,
      ) as { color?: string };
      // White on the light grey header was invisible behind the front card.
      expect(style.color).toBe("#333");
    });
  });
});
