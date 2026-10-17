import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CameraView } from "expo-camera";
import { X, Zap, ZapOff } from "lucide-react-native";
import { useEffect } from "react";
import {
  Linking,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { ThemeContextType, useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { useScannerLogic } from "../hooks/useScannerLogic";
import { OfflineCheckinOverlay } from "../components/OfflineCheckinOverlay";
import { CheckinResponse } from "../services/CheckinService";
import { formatDiscipline } from "../../../utils/discipline";
import { announce } from "../../../utils/announce";
import {
  CHECKIN_TITLES,
  checkinAnnouncement,
  checkinOutcome,
  registrationA11yLabel,
} from "../utils/scanAnnouncement";

// --- Subcomponent: Result Overlay ---
const CheckinResultOverlay = ({
  result,
  error,
  onClose,
  currentTheme,
}: {
  result: CheckinResponse | null;
  error: string | null;
  onClose: () => void;
  currentTheme: ThemeContextType["theme"];
}) => {
  // The verdict is only a coloured card over the camera: speak it (#22).
  useEffect(() => {
    const message = checkinAnnouncement(result, error);
    if (message) announce(message);
  }, [result, error]);

  if (!result && !error) return null;

  // Determine overall status
  const outcome = checkinOutcome(result, error);
  const title = CHECKIN_TITLES[outcome];
  let color = currentTheme.primaryFill;
  let content = null;

  if (error) {
    color = currentTheme.danger;
    content = (
      <AppText
        variant="body"
        style={[styles.errorText, { color: currentTheme.text }]}
      >
        {error}
      </AppText>
    );
  } else if (result) {
    if (outcome === "DENIED") {
      color = currentTheme.danger;
    } else if (outcome === "SUCCESS") {
      color = "#4CAF50"; // Success Green
    }

    content = (
      <View style={styles.fullWidth}>
        <AppText
          variant="h3"
          style={[styles.userName, { color: currentTheme.text }]}
        >
          {result.user.firstName} {result.user.lastName}
        </AppText>

        {result.qrVerification?.warning ? (
          <View
            style={[styles.badge, styles.warningBadge, styles.qrWarning]}
            testID="scanner-qr-warning"
            accessibilityRole="alert"
          >
            <AppText variant="caption" style={styles.whiteText}>
              {result.qrVerification.warning}
            </AppText>
          </View>
        ) : null}

        {result.registrations.map((reg, index) => (
          <View
            key={index}
            style={[styles.regItem, { borderColor: currentTheme.border }]}
            accessible
            accessibilityLabel={registrationA11yLabel(reg)}
            accessibilityHint="Inscription vérifiée par ce scan"
          >
            <AppText
              variant="caption"
              style={{ color: currentTheme.textSecondary }}
            >
              {formatDiscipline(reg.event)}
            </AppText>

            <View style={styles.regRow}>
              <AppText variant="h2" style={{ color: currentTheme.primary }}>
                Dossard: {reg.bibNumber ?? "N/A"}
              </AppText>
              {reg.status === "SUCCESS" && (
                <View style={[styles.badge, styles.successBadge]}>
                  <AppText variant="caption" style={styles.whiteText}>
                    OK
                  </AppText>
                </View>
              )}
              {reg.status === "ALREADY_CHECKED_IN" && (
                <View style={[styles.badge, styles.warningBadge]}>
                  <AppText variant="caption" style={styles.whiteText}>
                    Déjà fait
                  </AppText>
                </View>
              )}
              {reg.status === "ERROR" && (
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: currentTheme.danger },
                  ]}
                >
                  <AppText variant="caption" style={styles.whiteText}>
                    {reg.message ?? "Erreur"}
                  </AppText>
                </View>
              )}
            </View>

            {reg.partner && (
              <AppText
                variant="body"
                style={[styles.partnerText, { color: currentTheme.text }]}
              >
                Partenaire: {reg.partner}
              </AppText>
            )}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View
      style={styles.resultOverlay}
      testID="scanner-result-overlay"
      accessibilityViewIsModal
    >
      <View
        style={[styles.resultCard, { backgroundColor: currentTheme.surface }]}
      >
        <View style={[styles.resultHeader, { backgroundColor: color }]}>
          <AppText
            variant="h3"
            style={styles.whiteText}
            accessibilityRole="header"
          >
            {title}
          </AppText>
        </View>
        <View style={styles.resultContent}>
          {content}

          <TouchableOpacity
            testID="scanner-close-button"
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
};

type ScannerScreenProps = NativeStackScreenProps<RootStackParamList, "Scanner">;

export const ScannerScreen = ({ navigation, route }: ScannerScreenProps) => {
  const { theme: currentTheme } = useTheme();
  const insets = useSafeAreaInsets();

  const passedCompetitionId = route.params?.competitionId;

  const { state, actions } = useScannerLogic(passedCompetitionId);
  const {
    hasPermission,
    canAskAgain,
    torch,
    isActive,
    isLoading,
    result,
    offlineResult,
    error,
  } = state;

  if (!hasPermission) {
    // Après un refus, iOS ne réaffiche plus le prompt : requestPermission() se
    // résout en silence (bouton « mort »). On envoie alors vers les Réglages.
    const onPressAllow = () => {
      if (canAskAgain) {
        actions.requestPermission().catch(() => {});
      } else {
        Linking.openSettings().catch(() => {});
      }
    };
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: currentTheme.background },
        ]}
      >
        <AppText
          variant="body"
          style={{ color: currentTheme.text }}
          accessibilityRole="header"
        >
          Accès caméra requis
        </AppText>
        {!canAskAgain && (
          <AppText
            variant="caption"
            style={[
              styles.permissionHint,
              { color: currentTheme.textSecondary },
            ]}
          >
            L'accès a été refusé. Activez la caméra dans les Réglages.
          </AppText>
        )}
        <TouchableOpacity
          testID="scanner-permission-button"
          accessibilityRole="button"
          accessibilityLabel={
            canAskAgain
              ? "Autoriser l'accès à la caméra"
              : "Ouvrir les Réglages"
          }
          accessibilityHint="Autoriser l'accès à la caméra pour scanner les licences"
          onPress={onPressAllow}
          style={styles.mt20}
        >
          <AppText variant="button" style={{ color: currentTheme.primary }}>
            {canAskAgain ? "Autoriser" : "Ouvrir les Réglages"}
          </AppText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <CameraView
        testID="scanner-camera-view"
        style={StyleSheet.absoluteFill}
        facing="back"
        active={isActive}
        enableTorch={torch === "on"}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={
          isActive && !isLoading && !result && !offlineResult
            ? (scanResult) => {
                void actions.handleBarcodeScanned(scanResult);
              }
            : undefined
        }
      />

      <View style={StyleSheet.absoluteFill}>
        <View style={[styles.header, { top: insets.top + 10 }]}>
          <TouchableOpacity
            testID="scanner-back-button"
            accessibilityRole="button"
            accessibilityLabel="Retour"
            accessibilityHint="Retourner à l'écran précédent"
            style={styles.circleButton}
            onPress={() => navigation.goBack()}
          >
            <X size={24} color="#FFF" />
          </TouchableOpacity>

          <TouchableOpacity
            testID="scanner-torch-toggle"
            accessibilityRole="button"
            accessibilityLabel={
              torch === "on" ? "Éteindre la lampe" : "Allumer la lampe"
            }
            accessibilityHint="Activer ou désactiver la lampe torche de la caméra"
            style={styles.circleButton}
            onPress={actions.toggleTorch}
          >
            {torch === "on" ? (
              <Zap size={24} color="#FFD700" />
            ) : (
              <ZapOff size={24} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.scanFrameContainer}>
          <View
            style={styles.scanFrame}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
            {isActive && <View style={styles.scanLine} />}
          </View>
          <AppText
            variant="body"
            style={styles.scanPrompt}
            accessibilityHint="Le résultat du scan sera annoncé"
          >
            Placez le QR code dans le cadre
          </AppText>
        </View>
      </View>

      <CheckinResultOverlay
        result={result}
        error={error}
        onClose={actions.resetScan}
        currentTheme={currentTheme}
      />
      <OfflineCheckinOverlay
        result={offlineResult}
        onClose={actions.resetScan}
        currentTheme={currentTheme}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    position: "absolute",
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 10,
  },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrameContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 50,
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderRadius: 20,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderColor: "#E74C3C",
    borderWidth: 4,
    borderRadius: 4,
  },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  scanLine: {
    position: "absolute",
    left: 10,
    right: 10,
    top: "50%",
    height: 2,
    backgroundColor: "#E74C3C",
    opacity: 0.8,
  },
  resultOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  resultCard: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
  },
  resultHeader: {
    width: "100%",
    paddingVertical: 16,
    alignItems: "center",
  },
  resultContent: {
    padding: 20,
    alignItems: "center",
  },
  regItem: {
    width: "100%",
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
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
  errorText: {
    textAlign: "center",
  },
  fullWidth: {
    width: "100%",
  },
  userName: {
    textAlign: "center",
    marginBottom: 8,
  },
  regRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  whiteText: {
    color: "#fff",
  },
  successBadge: {
    backgroundColor: "#4CAF50",
  },
  warningBadge: {
    backgroundColor: "#FF9800",
  },
  qrWarning: {
    alignSelf: "center",
    marginBottom: 8,
    paddingVertical: 4,
  },
  partnerText: {
    marginTop: 4,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  mt20: {
    marginTop: 20,
  },
  permissionHint: {
    marginTop: 8,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  scanPrompt: {
    color: "rgba(255,255,255,0.8)",
    marginTop: 20,
  },
});
