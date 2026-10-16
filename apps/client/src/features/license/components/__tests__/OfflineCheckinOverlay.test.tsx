import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import type { ThemeContextType } from "../../../../context/ThemeContext";
import { OFFLINE_CHECKIN_MESSAGES } from "../../services/offlineCheckin";
import {
  OfflineCheckinOverlay,
  offlineCheckinVerdict,
} from "../OfflineCheckinOverlay";

jest.mock("../../../../components/AppText");

const theme = {
  surface: "#fff",
  text: "#000",
  textSecondary: "#555",
  border: "#ccc",
  danger: "#f00",
} as unknown as ThemeContextType["theme"];

describe("OfflineCheckinOverlay (#24)", () => {
  it("renders nothing without a result", async () => {
    await render(
      <OfflineCheckinOverlay
        result={null}
        onClose={jest.fn()}
        currentTheme={theme}
      />,
    );
    expect(screen.queryByTestId("scanner-offline-overlay")).toBeNull();
  });

  it("shows the holder of a valid offline scan and closes", async () => {
    const onClose = jest.fn();
    await render(
      <OfflineCheckinOverlay
        result={{
          status: "VALID",
          holderName: "DUPONT Jean",
          licenseNumber: "FFD-1",
          queued: true,
        }}
        onClose={onClose}
        currentTheme={theme}
      />,
    );
    expect(screen.getByText("LICENCE VÉRIFIÉE (HORS LIGNE)")).toBeTruthy();
    expect(screen.getByTestId("scanner-offline-holder")).toHaveTextContent(
      "DUPONT Jean",
    );
    expect(screen.getByText("FFD-1")).toBeTruthy();
    expect(screen.getByTestId("scanner-offline-message")).toHaveTextContent(
      OFFLINE_CHECKIN_MESSAGES.VALID_QUEUED,
    );
    await fireEvent.press(screen.getByTestId("scanner-offline-close-button"));
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    [
      "VALID",
      false,
      "LICENCE VÉRIFIÉE (HORS LIGNE)",
      "VALID_NOT_QUEUED",
      "#4CAF50",
    ],
    ["STALE", false, "QR PÉRIMÉ", "STALE", "#f00"],
    ["INVALID_SIGNATURE", false, "QR INVALIDE", "INVALID_SIGNATURE", "#f00"],
    [
      "NOT_ENTRY_QR",
      false,
      "VÉRIFICATION EN LIGNE REQUISE",
      "NOT_ENTRY_QR",
      "#FF9800",
    ],
    ["NO_KEYS", false, "VÉRIFICATION IMPOSSIBLE", "NO_KEYS", "#FF9800"],
  ] as const)(
    "%s (queued: %s) ⇒ %s",
    (status, queued, title, messageKey, color) => {
      expect(offlineCheckinVerdict({ status, queued }, "#f00")).toEqual({
        title,
        color,
        message: OFFLINE_CHECKIN_MESSAGES[messageKey],
      });
    },
  );
});
