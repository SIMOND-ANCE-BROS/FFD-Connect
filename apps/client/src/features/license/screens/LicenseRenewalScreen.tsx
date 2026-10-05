/* eslint-disable react-native-a11y/has-valid-accessibility-descriptors */
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
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
import { RootStackParamList } from "../../../navigation/types";
import type { LicenseRenewalDocumentType } from "../../../services/BackendService";
import { useLicenseRenewalLogic } from "../hooks/useLicenseRenewalLogic";

type Props = NativeStackScreenProps<RootStackParamList, "LicenseRenewal">;

const DOC_LABELS: Record<LicenseRenewalDocumentType, string> = {
  MEDICAL_CERTIFICATE: "Certificat médical",
  LICENSE_CERTIFICATE: "Certificat de licence",
};

export const LicenseRenewalScreen: React.FC<Props> = ({ navigation }) => {
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);

  const ocrTextStyle = { color: currentTheme.textSecondary };
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
      if (d.isApte !== undefined)
        lines.push(d.isApte ? "Apte à la pratique" : "Non apte");
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
          paddingTop: headerH + 8,
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
              Demande soumise
            </AppText>
            <AppText variant="body" style={statusSubtitleStyle}>
              Votre demande de renouvellement est en attente de validation. Vous
              serez notifié dès qu’elle sera traitée.
            </AppText>
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
              jusqu’au 31 août de la prochaine saison.
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
});
