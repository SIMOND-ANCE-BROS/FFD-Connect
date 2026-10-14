import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Alert, Linking } from "react-native";
import { CompetitionProgramSection } from "../CompetitionProgramSection";

jest.mock("../../../../../components/AppText");
jest.mock("../../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { surface: "#fff", primary: "#00f", textSecondary: "#666" },
  }),
}));

describe("CompetitionProgramSection links", () => {
  let openURL: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("opens a scheme-less registration link over https (FFD-CLIENT-7, #583)", async () => {
    const { getByLabelText } = await render(
      <CompetitionProgramSection registrationUrl="www.cergy-danse.com" />,
    );

    await fireEvent.press(getByLabelText("Ouvrir la page d'inscription"));

    expect(openURL).toHaveBeenCalledWith("https://www.cergy-danse.com");
  });

  it("hides the buttons of unusable links", async () => {
    const { queryByLabelText } = await render(
      <CompetitionProgramSection
        programUrl="   "
        registrationUrl="Voir le site du club"
        circularUrl="/uploads/circulaire.pdf"
      />,
    );

    expect(queryByLabelText("Ouvrir le programme (PDF)")).toBeNull();
    expect(queryByLabelText("Ouvrir la page d'inscription")).toBeNull();
    expect(queryByLabelText("Ouvrir la circulaire")).toBeNull();
  });

  it("shows an alert when the OS cannot open the link", async () => {
    openURL.mockRejectedValueOnce(
      new Error("No Activity found to handle Intent"),
    );
    const { getByLabelText } = await render(
      <CompetitionProgramSection programUrl="https://example.org/programme.pdf" />,
    );

    await fireEvent.press(getByLabelText("Ouvrir le programme (PDF)"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "Lien indisponible",
      expect.any(String),
    );
  });
});
