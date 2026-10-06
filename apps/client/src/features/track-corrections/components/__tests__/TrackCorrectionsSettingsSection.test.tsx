import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import type { AppTheme } from "../../../../context/ThemeContext";
import { TrackCorrectionApi } from "../../../../services/api/track-correction-api";
import { TrackCorrectionsSettingsSection } from "../TrackCorrectionsSettingsSection";

jest.mock("../../../../services/api/track-correction-api", () => ({
  TrackCorrectionApi: { pendingCount: jest.fn() },
}));

const pendingCount = TrackCorrectionApi.pendingCount as jest.Mock;

const theme = {
  background: "#fff",
  surface: "#f2f2f2",
  text: "#111",
  textSecondary: "#666",
  primary: "#3b82f6",
  border: "#e5e7eb",
  danger: "#ef4444",
} as unknown as AppTheme;

const renderSection = (isAdmin: boolean) => {
  const onOpenMine = jest.fn();
  const onOpenReview = jest.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <TrackCorrectionsSettingsSection
        theme={theme}
        isAdmin={isAdmin}
        onOpenMine={onOpenMine}
        onOpenReview={onOpenReview}
      />
    </QueryClientProvider>,
  );
  return { utils, onOpenMine, onOpenReview };
};

describe("TrackCorrectionsSettingsSection", () => {
  beforeEach(() => jest.clearAllMocks());

  it("admin : file de validation avec badge, puis « Mes propositions »", async () => {
    pendingCount.mockResolvedValue(3);
    const { utils, onOpenMine, onOpenReview } = renderSection(true);
    const { findByTestId, getByTestId } = await utils;

    const badge = await findByTestId("settings-track-corrections-badge");
    expect(badge).toBeTruthy();
    await fireEvent.press(getByTestId("settings-track-corrections-review"));
    expect(onOpenReview).toHaveBeenCalled();
    await fireEvent.press(getByTestId("settings-my-track-corrections"));
    expect(onOpenMine).toHaveBeenCalled();
  });

  it("non-admin : seulement « Mes propositions », sans requête de compteur", async () => {
    const { utils } = renderSection(false);
    const { queryByTestId, getByTestId } = await utils;

    expect(getByTestId("settings-my-track-corrections")).toBeTruthy();
    expect(queryByTestId("settings-track-corrections-review")).toBeNull();
    expect(pendingCount).not.toHaveBeenCalled();
  });

  it("pas de badge quand rien n'est en attente", async () => {
    pendingCount.mockResolvedValue(0);
    const { utils } = renderSection(true);
    const { queryByTestId, findByTestId } = await utils;
    await findByTestId("settings-track-corrections-review");
    expect(queryByTestId("settings-track-corrections-badge")).toBeNull();
  });
});
