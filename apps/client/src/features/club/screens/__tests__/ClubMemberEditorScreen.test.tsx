import { fireEvent, render } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { Alert } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import { ClubMemberEditorScreen } from "../ClubMemberEditorScreen";

jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));

describe("ClubMemberEditorScreen", () => {
  const mockTheme = {
    background: "#fff",
    surface: "#f2f2f2",
    text: "#111",
    textSecondary: "#666",
    primary: "#3b82f6",
    border: "#e5e7eb",
  };

  const navigation = { goBack: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    (useTheme as jest.Mock).mockReturnValue({ theme: mockTheme });
  });

  it("requires mandatory fields before saving", async () => {
    const { getByText } = await render(
      <ClubMemberEditorScreen
        navigation={navigation as never}
        route={{ params: {} } as never}
      />,
    );

    await fireEvent.press(getByText("Ajouter le membre"));
    expect(Alert.alert).toHaveBeenCalledWith(
      "Erreur",
      "Veuillez remplir les champs obligatoires (Nom, Prénom).",
    );
  });

  const member = {
    id: "m1",
    email: "jeanne@x.fr",
    firstName: "Jeanne",
    lastName: "Martin",
    role: "LICENSEE",
    category: "Ten Dance",
  };

  it("shows the competition level of each discipline", async () => {
    const { getByText } = await render(
      <ClubMemberEditorScreen
        navigation={navigation as never}
        route={
          {
            params: {
              member: {
                ...member,
                competitionLevelLatin: "Avancé",
                competitionLevelStandard: "Débutant",
                competitionLevel: "Intermédiaire",
              },
            },
          } as never
        }
      />,
    );

    expect(getByText("Niveau de compétition")).toBeTruthy();
    expect(getByText("Latines : Avancé · Standards : Débutant")).toBeTruthy();
  });

  it("falls back to the legacy single level", async () => {
    const { getByText } = await render(
      <ClubMemberEditorScreen
        navigation={navigation as never}
        route={
          {
            params: { member: { ...member, competitionLevel: "Avancé" } },
          } as never
        }
      />,
    );

    expect(getByText("Avancé")).toBeTruthy();
  });
});
