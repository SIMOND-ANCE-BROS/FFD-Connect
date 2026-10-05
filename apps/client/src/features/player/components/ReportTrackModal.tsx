import { BlurView } from "expo-blur";
import { Check, ChevronDown } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../../../context/ThemeContext";
import { BackendService } from "../../../services/BackendService";
import type { ReportTrackReason } from "../../../services/api/track-api";

interface ReportTrackModalProps {
  visible: boolean;
  onClose: () => void;
  /** Piste signalée. `null` tant qu'aucune piste n'est sélectionnée. */
  track: { id: string; title: string } | null;
}

/** Motifs proposés à l'utilisateur, dans l'ordre d'affichage. */
const REASONS: { value: ReportTrackReason; label: string }[] = [
  { value: "TITLE", label: "Titre incorrect" },
  { value: "ARTIST", label: "Artiste incorrect" },
  { value: "DANCE", label: "Danse (catégorie) incorrecte" },
  { value: "MPM", label: "MPM incorrect" },
  { value: "PASO_CLASH", label: "Clash paso doble incorrect" },
  { value: "OTHER", label: "Autre" },
];

/**
 * Modal de signalement d'un problème sur une piste. Ouvert à tout utilisateur
 * (les admins éditent directement via AddTrackModal). L'utilisateur choisit un
 * motif et peut ajouter des précisions ; le backend notifie les administrateurs.
 */
export const ReportTrackModal = ({
  visible,
  onClose,
  track,
}: ReportTrackModalProps) => {
  const { theme: currentTheme, isDark } = useTheme();

  const [selectedReason, setSelectedReason] =
    useState<ReportTrackReason | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(20)).current;
  const cardScale = useRef(new Animated.Value(0.98)).current;

  useEffect(() => {
    if (visible) {
      // Réinitialise le formulaire à chaque ouverture.
      setSelectedReason(null);
      setReasonOpen(false);
      setMessage("");
      setSending(false);
      cardTranslateY.setValue(20);
      cardScale.setValue(0.98);
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(cardTranslateY, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(cardScale, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      overlayOpacity.setValue(0);
      cardTranslateY.setValue(20);
      cardScale.setValue(0.98);
    }
  }, [visible, overlayOpacity, cardTranslateY, cardScale]);

  const handleSubmit = async () => {
    if (!track || !selectedReason) return;
    setSending(true);
    try {
      await BackendService.reportTrack(
        track.id,
        selectedReason,
        message.trim() || undefined,
      );
      Alert.alert("Merci", "Signalement envoyé");
      onClose();
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Une erreur est survenue";
      Alert.alert("Erreur lors du signalement", msg);
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="none" transparent>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer le signalement"
          accessibilityHint="Ferme la fenêtre de signalement sans envoyer"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        >
          <BlurView
            style={StyleSheet.absoluteFill}
            tint={isDark ? "dark" : "light"}
            intensity={20}
            pointerEvents="none"
          />
        </Pressable>
        <Animated.View
          style={[
            styles.container,
            { backgroundColor: currentTheme.surface },
            {
              transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
            },
          ]}
        >
          <View
            style={[styles.header, { borderBottomColor: currentTheme.border }]}
          >
            <Text style={[styles.headerTitle, { color: currentTheme.text }]}>
              Signaler un problème
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              accessibilityHint="Ferme la fenêtre de signalement"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Text style={[styles.closeText, { color: currentTheme.text }]}>
                ×
              </Text>
            </TouchableOpacity>
          </View>

          {sending ? (
            <View style={styles.loadingContent}>
              <ActivityIndicator size="large" color={currentTheme.primary} />
              <Text style={[styles.loadingText, { color: currentTheme.text }]}>
                Envoi...
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {track ? (
                <Text
                  style={[styles.trackTitle, { color: currentTheme.text }]}
                  numberOfLines={2}
                >
                  {track.title}
                </Text>
              ) : null}

              <Text
                style={[styles.label, { color: currentTheme.textSecondary }]}
              >
                Quel est le problème ?
              </Text>
              {/* Liste déroulante : champ replié → tap ouvre le menu → choix
                  referme. */}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Choisir un motif"
                accessibilityHint="Ouvre la liste des motifs de signalement"
                testID="report-reason-dropdown"
                onPress={() => setReasonOpen((o) => !o)}
                style={[
                  styles.dropdownTrigger,
                  isDark ? styles.bgDarkChip : styles.bgLightChip,
                  { borderColor: currentTheme.border },
                ]}
              >
                <Text
                  style={[
                    styles.dropdownTriggerText,
                    {
                      color: selectedReason
                        ? currentTheme.text
                        : currentTheme.textSecondary,
                    },
                  ]}
                >
                  {selectedReason
                    ? REASONS.find((r) => r.value === selectedReason)?.label
                    : "Choisir un motif…"}
                </Text>
                <ChevronDown
                  size={20}
                  color={currentTheme.textSecondary}
                  style={reasonOpen ? styles.chevronOpen : undefined}
                />
              </TouchableOpacity>

              {reasonOpen && (
                <View
                  style={[
                    styles.dropdownMenu,
                    {
                      backgroundColor: currentTheme.surface,
                      borderColor: currentTheme.border,
                    },
                  ]}
                >
                  {REASONS.map((r) => {
                    const selected = selectedReason === r.value;
                    return (
                      <TouchableOpacity
                        key={r.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={r.label}
                        accessibilityHint="Sélectionne ce motif de signalement"
                        testID={`report-reason-${r.value}`}
                        onPress={() => {
                          setSelectedReason(r.value);
                          setReasonOpen(false);
                        }}
                        style={[
                          styles.dropdownItem,
                          { borderBottomColor: currentTheme.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dropdownItemText,
                            { color: currentTheme.text },
                          ]}
                        >
                          {r.label}
                        </Text>
                        {selected && (
                          <Check size={18} color={currentTheme.primary} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <Text
                style={[styles.label, { color: currentTheme.textSecondary }]}
              >
                Précisions (facultatif)
              </Text>
              <TextInput
                accessibilityLabel="Précisions sur le problème"
                accessibilityHint="Décrivez le problème rencontré (facultatif)"
                style={[
                  styles.input,
                  styles.multiline,
                  isDark ? styles.bgDarkInput : styles.bgLightInput,
                  {
                    color: currentTheme.text,
                    borderColor: currentTheme.border,
                  },
                ]}
                testID="report-message-input"
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={500}
                placeholder="Ex. le titre exact est…"
                placeholderTextColor={currentTheme.textSecondary}
              />

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Envoyer le signalement"
                accessibilityHint="Envoie le signalement aux administrateurs"
                disabled={!selectedReason}
                style={[
                  styles.button,
                  {
                    backgroundColor: selectedReason
                      ? currentTheme.primary
                      : currentTheme.border,
                  },
                ]}
                onPress={() => {
                  handleSubmit().catch(() => {});
                }}
                testID="report-submit-button"
              >
                <Text
                  style={[
                    styles.buttonText,
                    isDark ? styles.textDarkButton : styles.textLightButton,
                  ]}
                >
                  Envoyer
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "center",
    padding: 20,
  },
  container: {
    borderRadius: 15,
    maxHeight: "80%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  closeButton: {
    padding: 5,
  },
  closeText: {
    fontSize: 24,
    lineHeight: 24,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 28,
  },
  trackTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
  },
  label: {
    marginBottom: 5,
    marginTop: 10,
  },
  input: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 5,
  },
  dropdownTriggerText: {
    fontSize: 15,
    flex: 1,
  },
  chevronOpen: {
    transform: [{ rotate: "180deg" }],
  },
  dropdownMenu: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropdownItemText: {
    fontSize: 15,
  },
  button: {
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
  },
  buttonText: {
    fontWeight: "bold",
    fontSize: 16,
  },
  loadingContent: {
    padding: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
  },
  bgDarkInput: { backgroundColor: "#222" },
  bgLightInput: { backgroundColor: "#F5F5F5" },
  bgDarkChip: { backgroundColor: "#333" },
  bgLightChip: { backgroundColor: "#E0E0E0" },
  textDarkButton: { color: "#000" },
  textLightButton: { color: "#FFF" },
  textDarkChipActive: { color: "#000", fontWeight: "bold" },
  textLightChipActive: { color: "#FFF", fontWeight: "bold" },
});
