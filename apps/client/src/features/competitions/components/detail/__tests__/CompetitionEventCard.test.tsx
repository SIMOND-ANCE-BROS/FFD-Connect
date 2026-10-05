import { render } from "@testing-library/react-native";
import React from "react";
import type { AppTheme } from "../../../../../context/ThemeContext";
import type { Event } from "../../../context/CompetitionContext";
import { CompetitionEventCard } from "../CompetitionEventCard";

jest.mock("../../../../../components/AppButton");
jest.mock("../../../../../components/AppText");

const theme = {
  text: "#000",
  textSecondary: "#666",
  surface: "#fff",
  danger: "#f00",
} as unknown as AppTheme;

const event: Event = {
  id: "evt-1",
  competitionId: "comp-1",
  category: "Latine",
  ageGroup: "Adulte",
  eventType: "COUPLE",
};

const renderCard = (showResults: boolean) =>
  render(
    <CompetitionEventCard
      currentTheme={theme}
      event={event}
      isRegistered={false}
      eligibility={{ eligible: true }}
      isOrganizer={false}
      canSelfRegister={true}
      showResults={showResults}
      onNavigateResults={jest.fn()}
      onRegister={jest.fn()}
      onUnregister={jest.fn()}
    />,
  );

describe("CompetitionEventCard", () => {
  it("shows the Résultats button when results are available (PAST/LIVE)", async () => {
    const { getByText, queryByText } = await renderCard(true);
    expect(getByText("Résultats")).toBeTruthy();
    // Register UI must be hidden when results are shown.
    expect(queryByText("S'inscrire")).toBeNull();
  });

  it("hides the Résultats button and shows register UI otherwise (UPCOMING)", async () => {
    const { queryByText, getByText } = await renderCard(false);
    expect(queryByText("Résultats")).toBeNull();
    expect(getByText("S'inscrire")).toBeTruthy();
  });

  it.each([
    ["register", true, "Inscription en attente de réseau", "Désinscrire"],
    ["unregister", false, "Désinscription en attente de réseau", "S'inscrire"],
  ] as const)(
    "shows the pending %s badge (offline queue #416)",
    async (pendingAction, isRegistered, label, button) => {
      const { getByText } = await render(
        <CompetitionEventCard
          currentTheme={theme}
          event={event}
          isRegistered={isRegistered}
          eligibility={{ eligible: true }}
          isOrganizer={false}
          canSelfRegister={true}
          showResults={false}
          onNavigateResults={jest.fn()}
          onRegister={jest.fn()}
          onUnregister={jest.fn()}
          pendingAction={pendingAction}
        />,
      );
      expect(getByText(label)).toBeTruthy();
      // The opposite action stays available: it cancels the pending one.
      expect(getByText(button)).toBeTruthy();
    },
  );

  it("shows no pending badge by default", async () => {
    const { queryByText } = await renderCard(false);
    expect(queryByText(/en attente de réseau/)).toBeNull();
  });
});
