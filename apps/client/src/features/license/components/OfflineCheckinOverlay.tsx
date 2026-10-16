import React, { useEffect } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../components/AppText";
import type { ThemeContextType } from "../../../context/ThemeContext";
import { announce } from "../../../utils/announce";
import { offlineCheckinAnnouncement } from "../utils/scanAnnouncement";
import {
  OFFLINE_CHECKIN_MESSAGES,
  type OfflineCheckinResult,
} from "../services/offlineCheckin";

const GREEN = "#4CAF50";
const ORANGE = "#FF9800";

interface Verdict {
  title: string;
  color: string;
  message: string;
}

export function offlineCheckinVerdict(
  result: OfflineCheckinResult,
  danger: string,
): Verdict {
  switch (result.status) {
    case "VALID":
      return {
        title: "LICENCE VÉRIFIÉE (HORS LIGNE)",
        color: GREEN,
        message: result.queued
          ? OFFLINE_CHECKIN_MESSAGES.VALID_QUEUED
          : OFFLINE_CHECKIN_MESSAGES.VALID_NOT_QUEUED,
      };
    case "STALE":
      return {
        title: "QR PÉRIMÉ",
        color: danger,
        message: OFFLINE_CHECKIN_MESSAGES.STALE,
      };
    case "INVALID_SIGNATURE":
      return {
        title: "QR INVALIDE",
        color: danger,
        message: OFFLINE_CHECKIN_MESSAGES.INVALID_SIGNATURE,
      };
    case "NOT_ENTRY_QR":
      return {
        title: "VÉRIFICATION EN LIGNE REQUISE",
        color: ORANGE,
        message: OFFLINE_CHECKIN_MESSAGES.NOT_ENTRY_QR,
      };
    case "NO_KEYS":
      return {
        title: "VÉRIFICATION IMPOSSIBLE",
        color: ORANGE,
        message: OFFLINE_CHECKIN_MESSAGES.NO_KEYS,
      };
  }
}

/**
 * Result of a scan verified without network (#24): green only for a genuine,
 * fresh rotating QR; the holder name comes from the signed QR, for the staff
 * to compare with the person in front of them.
 */
export function OfflineCheckinOverlay({
  result,
  onClose,
  currentTheme,
}: {
  result: OfflineCheckinResult | null;
  onClose: () => void;
  currentTheme: ThemeContextType["theme"];
}) {
  const { danger } = currentTheme;
  // The verdict is only shown over the camera: speak it once per scan (#22).
  useEffect(() => {
    if (!result) return;
    const { title, message } = offlineCheckinVerdict(result, danger);
    announce(offlineCheckinAnnouncement(title, message, result.holderName));
  }, [result, danger]);

  if (!result) return null;
  const verdict = offlineCheckinVerdict(result, currentTheme.danger);

  return (
    <View
      style={styles.overlay}
      testID="scanner-offline-overlay"
      accessibilityViewIsModal
    >
      <View style={[styles.card, { backgroundColor: currentTheme.surface }]}>
        <View style={[styles.header, { backgroundColor: verdict.color }]}>
          <AppText
            variant="h3"
            style={styles.whiteText}
            accessibilityRole="header"
          >
            {verdict.title}
          </AppText>
        </View>
        <View style={styles.content}>
          {result.holderName ? (
            <AppText
              variant="h3"
              style={[styles.centered, { color: currentTheme.text }]}
              testID="scanner-offline-holder"
            >
              {result.holderName}
            </AppText>
          ) : null}
          {result.licenseNumber ? (
            <AppText
              variant="caption"
              style={[styles.centered, { color: currentTheme.textSecondary }]}
              accessibilityLabel={`Licence ${result.licenseNumber}`}
              accessibilityHint="À comparer avec la licence présentée"
            >
              {result.licenseNumber}
            </AppText>
          ) : null}
          <AppText
            variant="body"
            style={[styles.message, { color: currentTheme.text }]}
            testID="scanner-offline-message"
          >
            {verdict.message}
          </AppText>
          <TouchableOpacity
            testID="scanner-offline-close-button"
            accessibilityRole="button"
            accessibilityLabel="Fermer le résultat et scanner un autre code"
            accessibilityHint="Fermer et retourner au scanner"
            style={[styles.closeButton, { borderColor: currentTheme.border }]}
            onPress={onClose}
          >
            <AppText variant="button" style={{ color: currentTheme.text }}>
              Scanner un autre code
            </AppText>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  card: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
  },
  header: {
    width: "100%",
    paddingVertical: 16,
    alignItems: "center",
  },
  content: {
    padding: 20,
    alignItems: "center",
  },
  centered: {
    textAlign: "center",
  },
  message: {
    textAlign: "center",
    marginTop: 12,
  },
  closeButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    width: "100%",
    alignItems: "center",
    marginTop: 20,
  },
  whiteText: {
    color: "#fff",
    textAlign: "center",
  },
});
