import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { useTheme, ThemeContextType } from "../../../../context/ThemeContext";
import { ClubEventRegistrationModal } from "../ClubEventRegistrationModal";

jest.mock("../../../../components/AppButton");

jest.mock("../../../../context/ThemeContext");

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

describe("ClubEventRegistrationModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTheme.mockReturnValue({
      theme: {
        background: "#fff",
        surface: "#f7f7f7",
        text: "#111",
        textSecondary: "#666",
        border: "#e0e0e0",
        primary: "#004481",
      },
    } as unknown as ThemeContextType);
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders empty state when no eligible members", async () => {
    const { getByText } = await render(
      <ClubEventRegistrationModal
        visible
        onClose={jest.fn()}
        onRegisterMembers={jest.fn().mockResolvedValue(undefined)}
        event={
          {
            category: "Latin",
            level: "A",
            ageGroup: "Senior",
            eventType: "SOLO",
          } as never
        }
        eligibleMembers={[]}
      />,
    );

    expect(getByText("Aucun membre éligible pour cette épreuve.")).toBeTruthy();
  });

  it("selects member and saves", async () => {
    const onClose = jest.fn();
    const onRegisterMembers = jest.fn().mockResolvedValue(undefined);
    const { getByText, getByTestId } = await render(
      <ClubEventRegistrationModal
        visible
        onClose={onClose}
        onRegisterMembers={onRegisterMembers}
        event={
          {
            category: "Latin",
            level: "A",
            ageGroup: "Senior",
            eventType: "SOLO",
          } as never
        }
        eligibleMembers={[
          {
            id: "m1",
            firstName: "Anna",
            lastName: "Durand",
            partnerName: null,
            role: "SOLO",
            license: "123",
            ageGroup: "Senior",
            level: "A",
          } as never,
        ]}
      />,
    );

    await fireEvent.press(getByText("Anna Durand"));
    expect(getByText("1 membre(s) sélectionné(s)")).toBeTruthy();

    await act(async () => {
      await fireEvent.press(getByTestId("btn-Valider les inscriptions"));
    });

    expect(onRegisterMembers).toHaveBeenCalledWith(["m1"], undefined);
    expect(onClose).toHaveBeenCalled();
  });
});
