import { BlurView } from "expo-blur";
import { Plus } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { AppText } from "../../../components/AppText";

import { AppTheme } from "../../../context/ThemeContext";
import { announce } from "../../../utils/announce";

interface WdsfEntryModalProps {
  visible: boolean;
  onClose: () => void;
  onVerify: (min: string) => void;
  loading: boolean;
  error?: string | null;
  theme: AppTheme;
  testID?: string;
  origin?: { x: number; y: number; width: number; height: number } | null;
}

export const WdsfEntryModal: React.FC<WdsfEntryModalProps> = ({
  visible,
  onClose,
  onVerify,
  loading,
  error,
  theme,
  origin,
  testID,
}) => {
  const [min, setMin] = useState("");
  const overlayOpacity = useSharedValue(0);
  const contentTranslateX = useSharedValue(0);
  const contentTranslateY = useSharedValue(16);
  const contentScale = useSharedValue(0.98);

  // The inline error is only shown visually: voice it (the focus stays on
  // the field / button, so the reader would not notice it otherwise).
  useEffect(() => {
    if (visible && error) announce(error);
  }, [visible, error]);

  const handleSubmit = () => {
    if (min.length > 0) onVerify(min);
  };

  useEffect(() => {
    if (visible) {
      if (origin) {
        const originCenterX = origin.x + origin.width / 2;
        const originCenterY = origin.y + origin.height / 2;
        contentTranslateX.value =
          originCenterX - Dimensions.get("window").width / 2;
        contentTranslateY.value =
          originCenterY - Dimensions.get("window").height / 2;
        contentScale.value = 0.9;
      } else {
        contentTranslateX.value = 0;
        contentTranslateY.value = 16;
        contentScale.value = 0.98;
      }

      overlayOpacity.value = withTiming(1, { duration: 200 });
      contentTranslateX.value = withTiming(0, { duration: 240 });
      contentTranslateY.value = withTiming(0, { duration: 220 });
      contentScale.value = withTiming(1, { duration: 220 });
      return;
    }
    overlayOpacity.value = 0;
    contentTranslateX.value = 0;
    contentTranslateY.value = 16;
    contentScale.value = 0.98;
  }, [
    visible,
    origin,
    overlayOpacity,
    contentTranslateX,
    contentTranslateY,
    contentScale,
  ]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: contentTranslateX.value },
      { translateY: contentTranslateY.value },
      { scale: contentScale.value },
    ],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalOverlayContainer}
      >
        <Animated.View style={[styles.modalOverlay, overlayStyle]}>
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={30}
            tint={theme.dark ? "dark" : "light"}
            pointerEvents="none"
          />
          {/* Fond et carte sont frères (cf. SpaceSheet) : un Pressable
              englobant le formulaire serait lu par VoiceOver comme un seul
              élément. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            testID="wdsf-modal-backdrop"
            accessibilityRole="button"
            accessibilityLabel="Fermer"
            accessibilityHint="Ferme l'ajout de licence WDSF"
          />
          <View pointerEvents="box-none" style={styles.modalContentWrapper}>
            <Animated.View
              testID={testID}
              onAccessibilityEscape={onClose}
              style={[
                styles.qrModalContent,
                styles.wdsfModalContent,
                { backgroundColor: theme.surface },
                contentStyle,
              ]}
            >
              <View style={styles.wdsfModalHeader}>
                <View
                  style={[
                    styles.wdsfIconBox,
                    { backgroundColor: theme.colors.ffdBlue },
                  ]}
                >
                  <Plus size={32} color="white" />
                </View>
                <AppText
                  variant="h2"
                  style={[styles.centerText, { color: theme.text }]}
                  accessibilityRole="header"
                >
                  Ajouter une licence WDSF
                </AppText>
                <AppText
                  variant="body"
                  style={[styles.modalSubtitle, { color: theme.textSecondary }]}
                >
                  Veuillez entrer votre numéro MIN (Member ID Number) pour
                  importer votre licence.
                </AppText>
              </View>

              <TextInput
                accessibilityLabel="Numéro MIN WDSF"
                accessibilityHint="Saisissez votre numéro MIN WDSF"
                testID="wdsf-modal-input"
                style={[
                  styles.input,
                  {
                    borderColor: error ? theme.colors.error : theme.border,
                    backgroundColor: theme.background,
                    color: theme.text,
                  },
                  error ? styles.marginBottomSmall : styles.marginBottomLarge,
                ]}
                placeholder="Ex: 10117265"
                placeholderTextColor={theme.textSecondary}
                value={min}
                onChangeText={setMin}
                keyboardType="numeric"
                autoFocus
              />

              {error && (
                <AppText
                  variant="caption"
                  style={[styles.errorText, { color: theme.colors.error }]}
                >
                  {error}
                </AppText>
              )}

              <View style={styles.modalActionRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Annuler"
                  accessibilityHint="Ferme l'ajout de licence WDSF"
                  onPress={onClose}
                  style={[styles.modalButton, { borderColor: theme.border }]}
                  testID="wdsf-modal-cancel-button"
                >
                  <AppText variant="button" style={{ color: theme.text }}>
                    Annuler
                  </AppText>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Vérifier"
                  accessibilityHint="Vérifie le numéro MIN et importe la licence WDSF"
                  accessibilityState={{
                    disabled: loading || min.length === 0,
                    busy: loading,
                  }}
                  testID="wdsf-modal-verify-button"
                  onPress={handleSubmit}
                  disabled={loading || min.length === 0}
                  style={[
                    styles.modalButtonPrimary,
                    { backgroundColor: theme.colors.ffdBlue },
                    loading || min.length === 0
                      ? styles.opacity60
                      : styles.opacity100,
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <AppText variant="button" style={styles.whiteText}>
                      Vérifier
                    </AppText>
                  )}
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalOverlayContainer: {
    flex: 1,
  },
  modalContentWrapper: {
    width: "100%",
    alignItems: "center",
  },
  qrModalContent: {
    padding: 30,
    borderRadius: 24,
    alignItems: "center",
    width: "90%",
  },
  wdsfModalContent: {
    width: "90%",
    padding: 24,
  },
  wdsfModalHeader: {
    alignItems: "center",
    marginBottom: 20,
  },
  wdsfIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  centerText: {
    textAlign: "center",
    marginBottom: 8,
  },
  modalSubtitle: {
    textAlign: "center",
  },
  input: {
    width: "100%",
    minHeight: 50,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 15,
    fontSize: 16,
  },
  errorText: {
    marginBottom: 10,
    textAlign: "center",
  },
  modalActionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  modalButton: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
  },
  modalButtonPrimary: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
  },
  whiteText: {
    color: "white",
    fontWeight: "600",
  },
  marginBottomSmall: {
    marginBottom: 8,
  },
  marginBottomLarge: {
    marginBottom: 20,
  },
  opacity60: {
    opacity: 0.6,
  },
  opacity100: {
    opacity: 1,
  },
});
