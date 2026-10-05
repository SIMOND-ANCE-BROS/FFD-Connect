import { LinearGradient } from "expo-linear-gradient";
import {
  AlertCircle,
  AlertTriangle,
  Bug,
  CheckCircle,
  ChevronRight,
  Image as ImageIcon,
  Info,
  Lightbulb,
  Send,
  Trash2,
  X,
} from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../../../context/ThemeContext";

import { useReportModalLogic } from "../hooks/useReportModalLogic";

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  visible,
  onClose,
}) => {
  const { theme: currentTheme, isDark } = useTheme();

  const { state, actions } = useReportModalLogic({ onClose });
  const {
    type,
    module,
    severity,
    title,
    description,
    steps,
    image,
    isSubmitting,
    isSuccess,
    MODULES,
  } = state;

  const {
    setType,
    setModule,
    setSeverity,
    setTitle,
    setDescription,
    setSteps,
    handlePickImage,
    handleRemoveImage,
    handleSubmit,
    handleClose,
  } = actions;

  if (isSuccess) {
    return (
      <Modal
        visible={visible}
        animationType="fade"
        presentationStyle="pageSheet"
        onRequestClose={handleClose}
      >
        <View
          style={[
            styles.container,
            styles.successContainer,
            { backgroundColor: currentTheme.background },
          ]}
        >
          <CheckCircle size={80} color="#4CAF50" />
          <Text style={[styles.successTitle, { color: currentTheme.text }]}>
            Rapport envoyé !
          </Text>
          <Text
            style={[
              styles.successMessage,
              { color: currentTheme.textSecondary },
            ]}
          >
            Merci de nous aider à améliorer l'application. Nous allons traiter
            votre {type === "BUG" ? "bug" : "suggestion"} au plus vite.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={handleClose}
            style={styles.successButton}
          >
            <Text style={styles.successButtonText}>Fermer</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: currentTheme.background }]}
      >
        <View
          style={[styles.header, { borderBottomColor: currentTheme.border }]}
        >
          <Text style={[styles.headerTitle, { color: currentTheme.text }]}>
            Faire un retour
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={handleClose}
            style={styles.closeButton}
          >
            <X size={24} color={currentTheme.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* Type Selector */}
          <View style={styles.typeContainer}>
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                styles.typeButton,
                type === "BUG" && styles.typeButtonActive,
                {
                  backgroundColor: currentTheme.surface,
                  borderColor: currentTheme.surface,
                },
                type === "BUG" && [
                  isDark ? styles.bugBgDark : styles.bugBgLight,
                  styles.bugBorder,
                ],
              ]}
              testID="report-type-bug"
              onPress={() => setType("BUG")}
            >
              <Bug
                size={20}
                color={type === "BUG" ? "#e74c3c" : currentTheme.textSecondary}
              />
              <Text
                style={[
                  styles.typeText,
                  { color: currentTheme.textSecondary },
                  type === "BUG" && styles.bugText,
                  type === "BUG" && styles.boldText,
                ]}
              >
                Bug
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              style={[
                styles.typeButton,
                type === "FEATURE" && styles.typeButtonActive,
                {
                  backgroundColor: currentTheme.surface,
                  borderColor: currentTheme.surface,
                },
                type === "FEATURE" && [
                  isDark ? styles.featureBgDark : styles.featureBgLight,
                  styles.featureBorder,
                ],
              ]}
              testID="report-type-feature"
              onPress={() => setType("FEATURE")}
            >
              <Lightbulb
                size={20}
                color={
                  type === "FEATURE" ? "#2196f3" : currentTheme.textSecondary
                }
              />
              <Text
                style={[
                  styles.typeText,
                  { color: currentTheme.textSecondary },
                  type === "FEATURE" && styles.featureText,
                  type === "FEATURE" && styles.boldText,
                ]}
              >
                Suggestion
              </Text>
            </TouchableOpacity>
          </View>

          {/* Severity (Only for BUG) */}
          {type === "BUG" && (
            <View style={styles.severityContainer}>
              <Text style={[styles.label, { color: currentTheme.text }]}>
                Sévérité
              </Text>
              <View style={styles.severityOptions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.severityChip,
                    {
                      backgroundColor: currentTheme.surface,
                      borderColor: currentTheme.border,
                    },
                    severity === "LOW" && [
                      isDark ? styles.lowBgDark : styles.lowBgLight,
                      styles.lowBorder,
                    ],
                  ]}
                  onPress={() => setSeverity("LOW")}
                  testID="report-severity-low"
                >
                  <Info
                    size={16}
                    color={
                      severity === "LOW"
                        ? "#4CAF50"
                        : currentTheme.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.severityText,
                      { color: currentTheme.textSecondary },
                      severity === "LOW" && [
                        styles.boldText,
                        { color: "#4CAF50" },
                      ],
                    ]}
                  >
                    Mineur
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.severityChip,
                    {
                      backgroundColor: currentTheme.surface,
                      borderColor: currentTheme.border,
                    },
                    severity === "MEDIUM" && [
                      isDark ? styles.mediumBgDark : styles.mediumBgLight,
                      styles.mediumBorder,
                    ],
                  ]}
                  onPress={() => setSeverity("MEDIUM")}
                  testID="report-severity-medium"
                >
                  <AlertCircle
                    size={16}
                    color={
                      severity === "MEDIUM"
                        ? "#FF9800"
                        : currentTheme.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.severityText,
                      { color: currentTheme.textSecondary },
                      severity === "MEDIUM" && [
                        styles.boldText,
                        { color: "#FF9800" },
                      ],
                    ]}
                  >
                    Gênant
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.severityChip,
                    {
                      backgroundColor: currentTheme.surface,
                      borderColor: currentTheme.border,
                    },
                    severity === "HIGH" && [
                      isDark ? styles.highBgDark : styles.highBgLight,
                      styles.highBorder,
                    ],
                  ]}
                  onPress={() => setSeverity("HIGH")}
                  testID="report-severity-high"
                >
                  <AlertTriangle
                    size={16}
                    color={
                      severity === "HIGH"
                        ? "#F44336"
                        : currentTheme.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.severityText,
                      { color: currentTheme.textSecondary },
                      severity === "HIGH" && [
                        styles.boldText,
                        { color: "#F44336" },
                      ],
                    ]}
                  >
                    Bloquant
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Module Selector */}
          <Text style={[styles.label, { color: currentTheme.text }]}>
            Module concerné
          </Text>
          <View style={styles.moduleScrollContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.moduleScroll}
              contentContainerStyle={styles.moduleContainer}
            >
              {MODULES.map((m) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  key={m}
                  style={[
                    styles.moduleChip,
                    {
                      backgroundColor: currentTheme.surface,
                      borderColor: currentTheme.border,
                    },
                    module === m && {
                      backgroundColor: currentTheme.primary,
                      borderColor: currentTheme.primary,
                    },
                  ]}
                  onPress={() => setModule(m)}
                >
                  <Text
                    style={[
                      styles.moduleText,
                      { color: currentTheme.textSecondary },
                      module === m && styles.moduleTextActive,
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              ))}
              {/* Spacer to ensure last item isn't covered by gradient/arrow */}
              <View style={styles.spacer} />
            </ScrollView>
            <View style={styles.scrollIndicatorContainer} pointerEvents="none">
              <LinearGradient
                colors={[
                  isDark ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)",
                  currentTheme.background,
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0.8, y: 0 }}
                style={styles.scrollGradient}
              />
              <ChevronRight
                size={20}
                color={currentTheme.textSecondary}
                style={styles.scrollArrow}
              />
            </View>
          </View>

          {/* Form Fields */}
          <Text style={[styles.label, { color: currentTheme.text }]}>
            Titre <Text style={styles.asterisk}>*</Text>
          </Text>
          <TextInput
            accessibilityLabel="Text input field"
            accessibilityHint="Saisissez un titre pour ce rapport"
            style={[
              styles.input,
              {
                backgroundColor: currentTheme.surface,
                borderColor: currentTheme.border,
                color: currentTheme.text,
              },
            ]}
            placeholder={
              type === "BUG"
                ? "Ex : l'application plante quand…"
                : "Ex : ajouter un bouton pour…"
            }
            placeholderTextColor={currentTheme.textSecondary}
            value={title}
            onChangeText={setTitle}
            testID="report-title-input"
          />

          <Text style={[styles.label, { color: currentTheme.text }]}>
            Description <Text style={styles.asterisk}>*</Text>
          </Text>
          <TextInput
            accessibilityLabel="Text input field"
            accessibilityHint="Décrivez avec plus de détails ce qui se passe ou votre suggestion"
            style={[
              styles.input,
              styles.textArea,
              {
                backgroundColor: currentTheme.surface,
                borderColor: currentTheme.border,
                color: currentTheme.text,
              },
            ]}
            placeholder={
              type === "BUG"
                ? "Décrivez ce qui se passe…"
                : "Décrivez votre suggestion…"
            }
            placeholderTextColor={currentTheme.textSecondary}
            multiline
            numberOfLines={4}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
            testID="report-desc-input"
          />

          {type === "BUG" && (
            <>
              <Text style={[styles.label, { color: currentTheme.text }]}>
                Étapes pour reproduire
              </Text>
              <TextInput
                accessibilityLabel="Text input field"
                accessibilityHint="Si c'est un bug, indiquez comment le reproduire pas à pas"
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    backgroundColor: currentTheme.surface,
                    borderColor: currentTheme.border,
                    color: currentTheme.text,
                  },
                ]}
                placeholder={"1. Aller sur…\n2. Cliquer sur…\n3. …"}
                placeholderTextColor={currentTheme.textSecondary}
                multiline
                numberOfLines={4}
                value={steps}
                onChangeText={setSteps}
                textAlignVertical="top"
                testID="report-steps-input"
              />
            </>
          )}

          {/* Image Picker */}
          <Text style={[styles.label, { color: currentTheme.text }]}>
            Capture d'écran
          </Text>
          {image ? (
            <View
              style={[
                styles.imagePreviewContainer,
                {
                  backgroundColor: currentTheme.surface,
                  borderColor: currentTheme.border,
                },
              ]}
            >
              <Text
                style={[styles.imageName, { color: currentTheme.text }]}
                numberOfLines={1}
              >
                {image.fileName}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={handleRemoveImage}
                style={styles.removeImageButton}
                testID="remove-image-button"
              >
                <Trash2 size={20} color={isDark ? "#ff6b6b" : "#e74c3c"} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                styles.attachButton,
                styles.borderWidth1,
                {
                  backgroundColor: currentTheme.surface,
                  borderColor: currentTheme.border,
                },
              ]}
              onPress={() => {
                handlePickImage().catch(() => {});
              }}
              testID="attach-image-button"
            >
              <ImageIcon size={20} color={currentTheme.textSecondary} />
              <Text
                style={[
                  styles.attachButtonText,
                  { color: currentTheme.textSecondary },
                ]}
              >
                Joindre une image
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            accessibilityRole="button"
            style={[
              styles.submitButton,
              { backgroundColor: currentTheme.primary },
              isSubmitting && styles.disabledButton,
            ]}
            onPress={() => {
              handleSubmit().catch(() => {});
            }}
            disabled={isSubmitting}
            testID="report-submit-button"
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Send size={20} color="white" />
                <Text style={styles.submitText}>
                  {type === "BUG"
                    ? "Envoyer le rapport"
                    : "Envoyer la suggestion"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: { fontSize: 18, fontWeight: "bold" },
  closeButton: { padding: 4 },
  content: { padding: 20 },
  typeContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  typeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  typeButtonActive: {
    borderColor: "rgba(0,0,0,0.1)",
  },
  typeText: { fontSize: 14, color: "#666" },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8, color: "#333" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: "#fafafa",
  },
  textArea: {
    minHeight: 100,
  },
  submitButton: {
    backgroundColor: "#222",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
  },
  disabledButton: { opacity: 0.7 },
  submitText: { color: "white", fontWeight: "bold", fontSize: 16 },
  attachButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    marginBottom: 20,
  },
  attachButtonText: { color: "#666", fontSize: 14, fontWeight: "500" },
  imagePreviewContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  imageName: { flex: 1, color: "#333", marginRight: 10 },
  removeImageButton: { padding: 4 },
  moduleScroll: {
    // marginBottom removed to fix centering of arrow
  },
  moduleScrollContainer: {
    position: "relative",
    marginBottom: 20,
  },
  scrollIndicatorContainer: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 60,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 0,
  },
  scrollGradient: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 60,
  },
  scrollArrow: {
    marginRight: 4,
    // Opacity removed for better visibility
  },
  moduleContainer: { flexDirection: "row", gap: 8, paddingRight: 40 },
  moduleChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#eee",
  },
  moduleText: { fontSize: 13, color: "#666", fontWeight: "500" },
  moduleTextActive: { color: "white" },
  successContainer: {
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginTop: 20,
    marginBottom: 10,
  },
  successMessage: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 30,
    lineHeight: 24,
  },
  successButton: {
    backgroundColor: "#4CAF50",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
  },
  successButtonText: { color: "white", fontWeight: "bold", fontSize: 16 },
  severityContainer: { marginBottom: 20 },
  severityOptions: { flexDirection: "row", gap: 10 },
  severityChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
    backgroundColor: "#fafafa",
  },
  severityText: { fontSize: 13, fontWeight: "500", color: "#999" },
  boldText: { fontWeight: "bold" },
  borderWidth1: { borderWidth: 1 },
  bugBgDark: { backgroundColor: "rgba(231, 76, 60, 0.2)" },
  bugBgLight: { backgroundColor: "#ffebee" },
  bugBorder: { borderColor: "#e74c3c" },
  bugText: { color: "#e74c3c" },
  featureBgDark: { backgroundColor: "rgba(33, 150, 243, 0.2)" },
  featureBgLight: { backgroundColor: "#e3f2fd" },
  featureBorder: { borderColor: "#2196f3" },
  featureText: { color: "#2196f3" },
  lowBgDark: { backgroundColor: "rgba(76, 175, 80, 0.2)" },
  lowBgLight: { backgroundColor: "#E8F5E9" },
  lowBorder: { borderColor: "#4CAF50" },
  mediumBgDark: { backgroundColor: "rgba(255, 152, 0, 0.2)" },
  mediumBgLight: { backgroundColor: "#FFF3E0" },
  mediumBorder: { borderColor: "#FF9800" },
  highBgDark: { backgroundColor: "rgba(244, 67, 54, 0.2)" },
  highBgLight: { backgroundColor: "#FFEBEE" },
  highBorder: { borderColor: "#F44336" },
  spacer: { width: 24 },
  asterisk: { color: "#e74c3c" },
});
