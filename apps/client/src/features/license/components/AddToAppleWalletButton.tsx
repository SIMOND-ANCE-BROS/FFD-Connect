import { Wallet } from "lucide-react-native";
import React from "react";
import { StyleSheet, View } from "react-native";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { useAppleWalletPass } from "../hooks/useAppleWalletPass";
import type { LicenseUser } from "./LicenseCard";

export const ADD_TO_APPLE_WALLET_LABEL = "Ajouter à Apple Wallet";
export const APPLE_WALLET_OFFLINE_HINT =
  "L'ajout à Apple Wallet nécessite une connexion. Votre E-Licence reste utilisable hors ligne dans l'app.";

interface AddToAppleWalletButtonProps {
  /** The FFD license shown on the screen. */
  license: LicenseUser | null | undefined;
  /** True when the license comes from the offline snapshot. */
  servedFromSnapshot: boolean;
}

/**
 * "Add to Apple Wallet" (#163). An app-styled button rather than Apple's
 * badge artwork: the badge must be downloaded from Apple under its own terms
 * and cannot be redistributed in this public repository. Renders nothing
 * outside iOS, when the server cannot issue the pass, or without a valid
 * license.
 */
export const AddToAppleWalletButton: React.FC<AddToAppleWalletButtonProps> = ({
  license,
  servedFromSnapshot,
}) => {
  const { theme } = useTheme();
  const { state, addToWallet } = useAppleWalletPass(license, {
    servedFromSnapshot,
  });

  if (!state.visible) return null;

  return (
    <View style={styles.container} testID="apple-wallet-section">
      <AppButton
        title={ADD_TO_APPLE_WALLET_LABEL}
        variant="outline"
        icon={
          <Wallet
            size={20}
            color={state.offline ? theme.textSecondary : theme.primary}
          />
        }
        onPress={() => {
          void addToWallet();
        }}
        loading={state.loading}
        disabled={state.offline}
        testID="license-apple-wallet-button"
        accessibilityLabel={ADD_TO_APPLE_WALLET_LABEL}
        accessibilityHint={
          state.offline
            ? APPLE_WALLET_OFFLINE_HINT
            : "Ouvre Safari, qui propose d'ajouter votre licence à Apple Wallet"
        }
      />
      {state.offline ? (
        <AppText
          variant="caption"
          color={theme.textSecondary}
          align="center"
          style={styles.message}
          testID="license-apple-wallet-offline"
        >
          {APPLE_WALLET_OFFLINE_HINT}
        </AppText>
      ) : null}
      {!state.offline && state.error ? (
        <AppText
          variant="caption"
          color={theme.danger}
          align="center"
          style={styles.message}
          testID="license-apple-wallet-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {state.error}
        </AppText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  message: {
    marginTop: 8,
  },
});
