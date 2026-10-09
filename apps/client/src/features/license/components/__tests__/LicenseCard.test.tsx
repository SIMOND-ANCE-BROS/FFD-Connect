import { render, within } from "@testing-library/react-native";
import React from "react";
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
});
