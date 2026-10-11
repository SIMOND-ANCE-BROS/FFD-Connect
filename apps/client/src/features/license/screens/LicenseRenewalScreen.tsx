/* eslint-disable react-native-a11y/has-valid-accessibility-descriptors */
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Stethoscope,
  Upload,
  XCircle,
} from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { useTheme } from "../../../context/ThemeContext";
import { useSensitiveScreen } from "../../../hooks/useSensitiveScreen";
import { RootStackParamList } from "../../../navigation/types";
import type { LicenseRenewalDocumentType } from "../../../services/api/license-api";
import { useLicenseRenewalLogic } from "../hooks/useLicenseRenewalLogic";
import {
  getRenewalOcrWarnings,
  rejectionReasonLabel,
} from "../utils/renewalReview";

type Props = NativeStackScreenProps<RootStackParamList, "LicenseRenewal">;

const DOC_LABELS: Record<LicenseRenewalDocumentType, string> = {
  MEDICAL_CERTIFICATE: "Certificat médical",
  LICENSE_CERTIFICATE: "Certificat de licence",
};

export const LicenseRenewalScreen: React.FC<Props> = ({ navigation }) => {
  // Medical certificate summary, OCR hints and the reason of a refusal on
  // screen (a reason can be medical): no Sentry screenshot (#242, #249).
  useSensitiveScreen();
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);

  const ocrTextStyle = { color: currentTheme.textSecondary };
  const warningTextStyle = [styles.warningText, { color: currentTheme.text }];
  const docTitleStyle = [styles.docHeaderTitle, { color: currentTheme.text }];
  const loadingTextStyle = [
    styles.loadingText,
    { color: currentTheme.textSecondary },
  ];
  const statusTitleStyle = [styles.statusTitle, { color: currentTheme.text }];
  const statusSubtitleStyle = [
    styles.statusSubtitle,
    { color: currentTheme.textSecondary },
  ];

  const {
    request,
    loading,
    uploadingType,
    submitting,
    canSubmit,
    step,
    getDoc,
    loadRenewal,
    startOrGetDraft,
    pickAndUploadDocument,
    submit,
  } = useLicenseRenewalLogic();

  useEffect(() => {
    loadRenewal().catch(() => {});
  }, [loadRenewal]);

  const renderOcrSummary = (doc: ReturnType<typeof getDoc>) => {
    if (!doc?.ocrData) return null;
    const d = doc.ocrData;
    const lines: string[] = [];
    if (doc.type === "MEDICAL_CERTIFICATE") {
      // A fitness not confirmed by the reading is a warning, below.
      if (d.isApte === true) lines.push("Apte à la pratique");
      if (d.date) lines.push(`Date : ${d.date}`);
      if (d.doctorName) lines.push(`Médecin : ${d.doctorName}`);
    } else {
      if (d.licenseNumber) lines.push(`N° licence : ${d.licenseNumber}`);
      if (d.expiryDate) lines.push(`Valable jusqu'au : ${d.expiryDate}`);
    }
    if (lines.length === 0) return null;
    return (
      <View
        style={[styles.ocrBox, { backgroundColor: currentTheme.background }]}
      >
        {lines.map((line, i) => (
          <AppText key={i} variant="caption" style={ocrTextStyle}>
            {line}
          </AppText>
        ))}
      </View>
    );
  };

  /**
   * Hints of the automatic reading: informative only, they never disable the
   * submission (#268) — an administrator checks every document (ADR-0021).
   */
  const renderOcrWarnings = (doc: NonNullable<ReturnType<typeof getDoc>>) => {
    const warnings = getRenewalOcrWarnings(doc);
    if (warnings.length === 0) return null;
    return (
      <View
        style={[
          styles.warningBox,
          {
            backgroundColor: `${currentTheme.warning}1A`,
            borderColor: currentTheme.warning,
          },
        ]}
        testID={`ocr-warnings-${doc.type}`}
      >
        {warnings.map((warning) => (
          <View key={warning} style={styles.warningRow}>
            <AlertTriangle size={14} color={currentTheme.warning} />
            <AppText variant="caption" style={warningTextStyle}>
              {warning}
            </AppText>
          </View>
        ))}
        <AppText variant="caption" style={ocrTextStyle}>
          À titre indicatif : vous pouvez soumettre votre demande, un
          administrateur vérifiera le document.
        </AppText>
      </View>
    );
  };

  const renderDocumentCard = (type: LicenseRenewalDocumentType) => {
    const doc = getDoc(type);
    const isUploading = uploadingType === type;
    const label = DOC_LABELS[type];
    const Icon = type === "MEDICAL_CERTIFICATE" ? Stethoscope : FileText;
    const uploadLabelColor = doc ? currentTheme.text : "#fff";
    const uploadLabelStyle = [
      styles.uploadBtnLabel,
      { color: uploadLabelColor },
    ];

    return (
      <View
        key={type}
        style={[
          styles.docCard,
          {
            backgroundColor: currentTheme.surface,
            borderColor: currentTheme.border,
          },
        ]}
      >
        <View
          style={[styles.docHeader, { borderBottomColor: currentTheme.border }]}
        >
          <Icon size={22} color={currentTheme.primary} />
          <AppText variant="h3" style={docTitleStyle}>
            {label}
          </AppText>
          {doc && (
            <View
              style={[styles.badge, { backgroundColor: currentTheme.primary }]}
            >
              <CheckCircle2 size={14} color="#fff" />
              <AppText variant="caption" style={styles.badgeText}>
                Déposé
              </AppText>
            </View>
          )}
        </View>
        {doc && renderOcrSummary(doc)}
        {doc && renderOcrWarnings(doc)}
        <TouchableOpacity
          style={[
            styles.uploadBtn,
            {
              backgroundColor: doc
                ? currentTheme.background
                : currentTheme.primary,
              borderColor: currentTheme.border,
            },
          ]}
          onPress={() => {
            pickAndUploadDocument(type).catch(() => {});
          }}
          disabled={!!uploadingType}
        >
          {isUploading ? (
            <ActivityIndicator size="small" color={currentTheme.primary} />
          ) : (
            <>
              <Upload size={18} color={doc ? currentTheme.text : "#fff"} />
              <AppText variant="button" style={uploadLabelStyle}>
                {doc ? "Remplacer" : "Ajouter le document"}
              </AppText>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const rejectionLabel = rejectionReasonLabel(request?.rejectionReason);
  const submittedOn = request?.submittedAt
    ? new Date(request.submittedAt).toLocaleDateString("fr-FR")
    : null;
  const statusDateStyle = [styles.statusDate, ocrTextStyle];
  const reviewValueStyle = [styles.reviewValue, { color: currentTheme.text }];

  const submitButtonStyle = [
    styles.primaryButton,
    {
      backgroundColor: canSubmit ? currentTheme.primary : currentTheme.border,
      opacity: canSubmit ? 1 : 0.7,
    },
  ];
  const retryButtonStyle = [
    styles.primaryButton,
    styles.statusActionButton,
    { backgroundColor: currentTheme.primary },
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
      edges={["left", "right"]}
    >
      <StatusBar
        barStyle={currentTheme.statusBarStyle}
        backgroundColor={currentTheme.background}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          ...styles.scrollContent,
          paddingTop: headerH,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {loading && !request && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={currentTheme.primary} />
            <AppText variant="body" style={loadingTextStyle}>
              Chargement…
            </AppText>
          </View>
        )}

        {!loading && !request && (
          <View style={styles.centered}>
            <AppText
              variant="body"
              style={[styles.intro, { color: currentTheme.text }]}
            >
              Déposez votre certificat médical et votre certificat de licence
              pour renouveler votre licence. Les documents seront analysés
              automatiquement (OCR).
            </AppText>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: currentTheme.primary },
              ]}
              onPress={() => {
                startOrGetDraft().catch(() => {});
              }}
            >
              <AppText variant="button" style={styles.whiteText}>
                Commencer une demande
              </AppText>
            </TouchableOpacity>
          </View>
        )}

        {request && step === "documents" && (
          <>
            <AppText
              variant="body"
              style={[styles.intro, { color: currentTheme.textSecondary }]}
            >
              Ajoutez les deux documents ci-dessous, puis soumettez votre
              demande.
            </AppText>
            {renderDocumentCard("MEDICAL_CERTIFICATE")}
            {renderDocumentCard("LICENSE_CERTIFICATE")}
            <TouchableOpacity
              style={submitButtonStyle}
              onPress={() => {
                submit().catch(() => {});
              }}
              disabled={!canSubmit || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <AppText variant="button" style={styles.whiteText}>
                  Soumettre la demande
                </AppText>
              )}
            </TouchableOpacity>
          </>
        )}

        {request && step === "submitted" && (
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: currentTheme.surface,
                borderColor: currentTheme.border,
              },
            ]}
          >
            <FileText size={48} color={currentTheme.primary} />
            <AppText variant="h2" style={statusTitleStyle}>
              Demande en cours de vérification
            </AppText>
            <AppText variant="body" style={statusSubtitleStyle}>
              Votre demande de renouvellement est en attente de validation. Vous
              serez notifié dès qu’elle sera traitée.
            </AppText>
            {submittedOn ? (
              <AppText variant="caption" style={statusDateStyle}>
                {`Envoyée le ${submittedOn}`}
              </AppText>
            ) : null}
          </View>
        )}

        {request && step === "approved" && (
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: currentTheme.surface,
                borderColor: currentTheme.border,
              },
            ]}
          >
            <CheckCircle2 size={48} color="#4CAF50" />
            <AppText variant="h2" style={statusTitleStyle}>
              Licence renouvelée
            </AppText>
            <AppText variant="body" style={statusSubtitleStyle}>
              Votre licence a été renouvelée avec succès. Elle est valable
              jusqu’au 31 août de la saison en cours, ou de la saison suivante
              si vous l’avez renouvelée entre le 1er juillet et le 31 août.
            </AppText>
          </View>
        )}

        {request && step === "rejected" && (
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: currentTheme.surface,
                borderColor: currentTheme.border,
              },
            ]}
          >
            <XCircle size={48} color={currentTheme.danger} />
            <AppText variant="h2" style={statusTitleStyle}>
              Demande refusée
            </AppText>
            <AppText variant="body" style={statusSubtitleStyle}>
              Votre demande n’a pas pu être validée. Vous pouvez déposer une
              nouvelle demande avec des documents conformes.
            </AppText>
            {rejectionLabel || request.reviewComment ? (
              <View
                style={[
                  styles.reviewBox,
                  { backgroundColor: currentTheme.background },
                ]}
                testID="renewal-rejection-details"
              >
                {rejectionLabel ? (
                  <>
                    <AppText variant="caption" style={ocrTextStyle}>
                      Motif du refus
                    </AppText>
                    <AppText variant="body" style={reviewValueStyle}>
                      {rejectionLabel}
                    </AppText>
                  </>
                ) : null}
                {request.reviewComment ? (
                  <>
                    <AppText
                      variant="caption"
                      style={[
                        ocrTextStyle,
                        rejectionLabel ? styles.reviewGap : null,
                      ]}
                    >
                      Commentaire de l’administrateur
                    </AppText>
                    <AppText variant="body" style={reviewValueStyle}>
                      {request.reviewComment}
                    </AppText>
                  </>
                ) : null}
              </View>
            ) : null}
            <TouchableOpacity
              style={retryButtonStyle}
              onPress={() => {
                startOrGetDraft().catch(() => {});
              }}
            >
              <AppText variant="button" style={styles.whiteText}>
                Nouvelle demande
              </AppText>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <PinnedHeader
        theme={currentTheme}
        isDark={isDark}
        title="Renouvellement de licence"
        onHeightChange={setHeaderH}
        left={<BackButton onPress={() => navigation.goBack()} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  intro: { marginBottom: 20, textAlign: "center" },
  primaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    minWidth: 200,
  },
  whiteText: { color: "#fff" },
  docCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  docHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  badgeText: { color: "#fff" },
  ocrBox: {
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    marginBottom: 12,
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  docHeaderTitle: {
    marginLeft: 8,
  },
  uploadBtnLabel: {
    marginLeft: 8,
  },
  statusTitle: {
    marginTop: 16,
    textAlign: "center" as const,
  },
  statusSubtitle: {
    marginTop: 8,
    textAlign: "center" as const,
  },
  statusActionButton: {
    marginTop: 24,
  },
  loadingText: {
    marginTop: 12,
  },
  warningBox: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    gap: 6,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  warningText: {
    flex: 1,
  },
  reviewBox: {
    alignSelf: "stretch",
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  reviewValue: {
    marginTop: 2,
  },
  reviewGap: {
    marginTop: 12,
  },
  statusDate: {
    marginTop: 12,
  },
});
