/** Avis de mise à jour de la politique de confidentialité (#734). */
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { AccessibilityInfo } from "react-native";
import { PrivacyPolicyApi } from "../../../services/api/privacy-policy-api";
import { usePrivacyPolicyNoticeStore } from "../../../stores/privacyPolicyNotice.store";
import {
  PRIVACY_NOTICE_TITLE,
  PrivacyPolicyNotice,
} from "../PrivacyPolicyNotice";

jest.mock("../../../services/api/privacy-policy-api", () => ({
  PrivacyPolicyApi: { pendingVersion: jest.fn(), acknowledge: jest.fn() },
}));
jest.mock("../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      border: "#ddd",
      primary: "#007AFF",
    },
  }),
}));

const pendingVersion = PrivacyPolicyApi.pendingVersion as jest.Mock;
const acknowledge = PrivacyPolicyApi.acknowledge as jest.Mock;

describe("PrivacyPolicyNotice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePrivacyPolicyNoticeStore.getState().reset();
    acknowledge.mockResolvedValue(true);
  });

  it("s'affiche une fois connecté quand une nouvelle version est en attente", async () => {
    pendingVersion.mockResolvedValue("2026-10-17");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");

    const { findByText } = await render(
      <PrivacyPolicyNotice eligible onOpenPolicy={jest.fn()} />,
    );

    expect(await findByText(PRIVACY_NOTICE_TITLE)).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(PRIVACY_NOTICE_TITLE);
  });

  it("ne rend rien quand la version en vigueur a déjà été lue", async () => {
    pendingVersion.mockResolvedValue(null);

    const { queryByTestId } = await render(
      <PrivacyPolicyNotice eligible onOpenPolicy={jest.fn()} />,
    );
    await act(async () => {});

    expect(queryByTestId("privacy-policy-notice")).toBeNull();
  });

  it("ne consulte même pas le serveur pour un invité ou un accès support", async () => {
    const { queryByTestId } = await render(
      <PrivacyPolicyNotice eligible={false} onOpenPolicy={jest.fn()} />,
    );
    await act(async () => {});

    expect(pendingVersion).not.toHaveBeenCalled();
    expect(queryByTestId("privacy-policy-notice")).toBeNull();
  });

  it("« J'ai compris » ferme l'avis et enregistre la version lue", async () => {
    pendingVersion.mockResolvedValue("2026-10-17");
    const { findByTestId, queryByTestId } = await render(
      <PrivacyPolicyNotice eligible onOpenPolicy={jest.fn()} />,
    );

    await fireEvent.press(await findByTestId("privacy-policy-notice-ack"));

    await waitFor(() => {
      expect(queryByTestId("privacy-policy-notice")).toBeNull();
    });
    expect(acknowledge).toHaveBeenCalledWith("2026-10-17");
  });

  it("« Lire la politique » ouvre le texte et ferme l'avis", async () => {
    pendingVersion.mockResolvedValue("2026-10-17");
    const onOpenPolicy = jest.fn();
    const { findByTestId, queryByTestId } = await render(
      <PrivacyPolicyNotice eligible onOpenPolicy={onOpenPolicy} />,
    );

    await fireEvent.press(await findByTestId("privacy-policy-notice-read"));

    expect(onOpenPolicy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(queryByTestId("privacy-policy-notice")).toBeNull();
    });
    expect(acknowledge).toHaveBeenCalledWith("2026-10-17");
  });

  it("disparaît à la déconnexion", async () => {
    pendingVersion.mockResolvedValue("2026-10-17");
    const { findByTestId, queryByTestId, rerender } = await render(
      <PrivacyPolicyNotice eligible onOpenPolicy={jest.fn()} />,
    );
    await findByTestId("privacy-policy-notice");

    await rerender(
      <PrivacyPolicyNotice eligible={false} onOpenPolicy={jest.fn()} />,
    );

    expect(queryByTestId("privacy-policy-notice")).toBeNull();
    expect(usePrivacyPolicyNoticeStore.getState().pendingVersion).toBeNull();
  });

  it("lecteur d'écran (#22) : titre en intitulé, boutons nommés", async () => {
    pendingVersion.mockResolvedValue("2026-10-17");
    const { findByRole, getByLabelText } = await render(
      <PrivacyPolicyNotice eligible onOpenPolicy={jest.fn()} />,
    );

    expect(
      await findByRole("header", { name: PRIVACY_NOTICE_TITLE }),
    ).toBeTruthy();
    expect(getByLabelText("Lire la politique de confidentialité")).toBeTruthy();
    expect(
      getByLabelText(
        "J'ai compris, fermer le message sur la politique de confidentialité",
      ),
    ).toBeTruthy();
  });
});
