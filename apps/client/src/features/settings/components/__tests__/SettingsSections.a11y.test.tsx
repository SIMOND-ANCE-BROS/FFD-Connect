import { fireEvent, render } from "@testing-library/react-native";
import React, { createRef } from "react";
import type { View } from "react-native";
import { SettingsClubSection } from "../SettingsClubSection";
import { SettingsPrivacySection } from "../SettingsPrivacySection";
import { SettingsProfileSection } from "../SettingsProfileSection";
import { SettingsSecuritySection } from "../SettingsSecuritySection";
import { SettingsTechnicalSection } from "../SettingsTechnicalSection";

// Screen-reader contract of the settings sections (RGAA, issue #22).

const theme = {
  textSecondary: "#666",
  surface: "#fff",
  text: "#000",
  border: "#ddd",
  primary: "#00f",
  background: "#fafafa",
} as never;

describe("Settings sections accessibility", () => {
  it("exposes the section titles as headings", async () => {
    const { getByRole } = await render(
      <>
        <SettingsSecuritySection
          theme={theme}
          biometryType="FaceID"
          biometricsEnabled
          toggleBiometrics={jest.fn()}
          isFaceId
          onChangePassword={jest.fn()}
        />
        <SettingsPrivacySection
          theme={theme}
          isGuest={false}
          exporting={false}
          onExportData={jest.fn()}
          onDeleteAccount={jest.fn()}
          onOpenLegal={jest.fn()}
          usageEnabled={null}
          onToggleUsage={jest.fn()}
        />
        <SettingsTechnicalSection
          theme={theme}
          handleShowTechInfo={jest.fn().mockResolvedValue(undefined)}
          onOpenReportModal={jest.fn()}
        />
      </>,
    );
    expect(getByRole("header", { name: "Sécurité" })).toBeTruthy();
    expect(
      getByRole("header", { name: "Confidentialité et données" }),
    ).toBeTruthy();
    expect(getByRole("header", { name: "Technique" })).toBeTruthy();
  });

  it("names the security controls and keeps their testIDs", async () => {
    const onChangePassword = jest.fn();
    const changePasswordRef = createRef<View>();
    const { getByRole, getByLabelText } = await render(
      <SettingsSecuritySection
        theme={theme}
        biometryType="FaceID"
        biometricsEnabled={false}
        toggleBiometrics={jest.fn()}
        isFaceId
        onChangePassword={onChangePassword}
        changePasswordRef={changePasswordRef}
      />,
    );
    const button = getByRole("button", { name: "Changer le mot de passe" });
    expect(button.props.testID).toBe("settings-change-password-button");
    await fireEvent.press(button);
    expect(onChangePassword).toHaveBeenCalled();
    // The row is the focus target once the modal closes.
    expect(changePasswordRef.current).not.toBeNull();
    expect(getByLabelText("Connexion avec Face ID").props.testID).toBe(
      "settings-biometrics-switch",
    );
  });

  it("attaches the focus-return ref to the delete-account row", async () => {
    const deleteAccountRef = createRef<View>();
    const { getByRole } = await render(
      <SettingsPrivacySection
        theme={theme}
        isGuest={false}
        exporting
        onExportData={jest.fn()}
        onDeleteAccount={jest.fn()}
        onOpenLegal={jest.fn()}
        usageEnabled={null}
        onToggleUsage={jest.fn()}
        deleteAccountRef={deleteAccountRef}
      />,
    );
    expect(deleteAccountRef.current).not.toBeNull();
    // Export in progress is announced as busy.
    expect(
      getByRole("button", { name: "Exporter mes données" }).props
        .accessibilityState,
    ).toEqual({ disabled: true, busy: true });
  });

  it("reads the registration policies as radio buttons with their state", async () => {
    const onSet = jest.fn().mockResolvedValue(undefined);
    const { getByRole, getAllByRole } = await render(
      <SettingsClubSection
        theme={theme}
        registrationPolicy="MEMBER_VALIDATION"
        handleSetRegistrationPolicy={onSet}
        helloAssoStatus={null}
        paymentProviderStatus={null}
        onSelectPaymentProvider={jest.fn().mockResolvedValue(undefined)}
        onOpenHelloAsso={jest.fn()}
      />,
    );
    expect(getAllByRole("radio")).toHaveLength(3);
    const selected = getByRole("radio", {
      name: "Membre (avec validation), Les membres s'inscrivent, le club valide.",
    });
    expect(selected.props.accessibilityState).toEqual({ checked: true });
    expect(selected.props.testID).toBe("settings-reg-policy-MEMBER_VALIDATION");
    await fireEvent.press(
      getByRole("radio", {
        name: "Club uniquement, Seul le club peut inscrire les membres.",
      }),
    );
    expect(onSet).toHaveBeenCalledWith("CLUB_ONLY");
    expect(
      getByRole("button", {
        name: "Connecteur de paiement : HelloAsso, non configuré",
      }),
    ).toBeTruthy();
  });

  it("does not read the photo caption twice", async () => {
    const { getByRole, queryByText } = await render(
      <SettingsProfileSection
        theme={theme}
        role="LICENSEE"
        photoUri={null}
        clubLogoUri={null}
        onSelectPhoto={jest.fn()}
        onSelectClubLogo={jest.fn()}
      />,
    );
    expect(
      getByRole("button", { name: "Changer ma photo de profil" }),
    ).toBeTruthy();
    expect(queryByText("Modifier ma photo")).toBeNull();
    expect(
      queryByText("Modifier ma photo", { includeHiddenElements: true }),
    ).toBeTruthy();
  });
});
