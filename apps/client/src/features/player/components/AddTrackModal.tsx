import { BlurView } from "expo-blur";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useLibrary } from "../context/LibraryContext";
import { DANCE_GROUPS, mpmFromBpm } from "../utils/danceTempo";
import { formatDiscipline } from "../../../utils/discipline";

export interface EditableTrack {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  rawBpm?: number;
  style?: string | null;
  filename: string;
}

interface AddTrackModalProps {
  visible: boolean;
  onClose: () => void;
  /** The track to edit (metadata: title/artist/dance/MPM). ADMIN-only — the
   *  affordance is gated in LibraryScreen and the backend enforces ADMIN. */
  editTrack?: EditableTrack | null;
}

const STYLES_LIST = DANCE_GROUPS.flatMap((g) => g.dances);

/**
 * Éditeur de métadonnées d'une piste (titre / artiste / danse / MPM). L'ancien
 * système d'import (URL YouTube/Spotify → download yt-dlp) a été retiré ; ce
 * modal ne sert plus qu'à modifier une piste existante (admin). La conversion
 * BPM→MPM (danceTempo) est conservée pour recalculer le MPM au changement de
 * danse.
 */
export const AddTrackModal = ({
  visible,
  onClose,
  editTrack,
}: AddTrackModalProps) => {
  const { theme: currentTheme, isDark } = useTheme();
  const { reloadLibrary } = useLibrary();

  const [saving, setSaving] = useState(false);

  // Raw detected BPM, kept so we can recompute the dance-aware MPM live as the
  // user changes the dance (the backend stays authoritative on save).
  const rawBpmRef = useRef(0);

  // Editable fields
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [bpm, setBpm] = useState("");
  const [selectedStyle, setSelectedStyle] = useState(STYLES_LIST[0]);

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(20)).current;
  const cardScale = useRef(new Animated.Value(0.98)).current;

  // Tracks whether the user manually edited a field (only edited fields are PATCHed).
  const editedTitleRef = useRef(false);
  const editedArtistRef = useRef(false);
  const editedBpmRef = useRef(false);
  const editedStyleRef = useRef(false);

  useEffect(() => {
    if (visible) {
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

  // Prefill the form from the edited track each time it opens.
  useEffect(() => {
    if (!visible || !editTrack) return;
    rawBpmRef.current = editTrack.rawBpm ?? editTrack.bpm;
    setTitle(editTrack.title);
    setArtist(editTrack.artist);
    setSelectedStyle(editTrack.style ?? STYLES_LIST[0]);
    setBpm(editTrack.bpm ? String(editTrack.bpm) : "");
    editedTitleRef.current = false;
    editedArtistRef.current = false;
    editedBpmRef.current = false;
    editedStyleRef.current = false;
    setSaving(false);
  }, [visible, editTrack]);

  // Recompute the dance-aware MPM shown in the editable field whenever the
  // dance changes — unless the user has manually overridden the tempo.
  const applyAutoMpm = useCallback((dance: string) => {
    if (editedBpmRef.current) return;
    const raw = rawBpmRef.current;
    if (raw > 0) setBpm(String(mpmFromBpm(raw, dance)));
  }, []);

  const buildPatch = () => {
    const patch: {
      title?: string;
      artist?: string;
      bpm?: number;
      style?: string;
    } = {};
    if (editedTitleRef.current && title.trim()) patch.title = title.trim();
    if (editedArtistRef.current && artist.trim()) patch.artist = artist.trim();
    if (editedBpmRef.current) {
      const n = parseInt(bpm, 10);
      if (Number.isFinite(n) && n >= 0) patch.bpm = n;
    }
    if (selectedStyle) patch.style = selectedStyle;
    return patch;
  };

  const handleSave = async () => {
    if (!editTrack) return;
    const patch = buildPatch();
    setSaving(true);
    try {
      if (Object.keys(patch).length > 0) {
        await BackendService.updateTrack(editTrack.id, patch);
      }
      Alert.alert("Succès", "Musique modifiée.");
      await reloadLibrary();
      onClose();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Une erreur est survenue";
      Alert.alert("Erreur lors de la modification", message);
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!editTrack) return;
    Alert.alert(
      "Supprimer la musique",
      "Cette action est définitive. La musique sera retirée de la bibliothèque pour tout le monde.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () => {
            setSaving(true);
            BackendService.deleteTrack(editTrack.id)
              .then(async () => {
                Alert.alert("Succès", "Musique supprimée.");
                await reloadLibrary();
                onClose();
              })
              .catch((error: unknown) => {
                const message =
                  error instanceof Error
                    ? error.message
                    : "Une erreur est survenue";
                Alert.alert("Erreur lors de la suppression", message);
                setSaving(false);
              });
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="none" transparent>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable
          accessibilityRole="button"
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
              Modifier la musique
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Text style={[styles.closeText, { color: currentTheme.text }]}>
                ×
              </Text>
            </TouchableOpacity>
          </View>

          {saving ? (
            <View style={styles.loadingContent}>
              <ActivityIndicator size="large" color={currentTheme.primary} />
              <Text style={[styles.loadingText, { color: currentTheme.text }]}>
                Enregistrement...
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
              <Text
                style={[styles.label, { color: currentTheme.textSecondary }]}
              >
                Titre
              </Text>
              <TextInput
                accessibilityLabel="Titre de la musique"
                accessibilityHint="Modifiez le titre de la musique"
                style={[
                  styles.input,
                  isDark ? styles.bgDarkInput : styles.bgLightInput,
                  {
                    color: currentTheme.text,
                    borderColor: currentTheme.border,
                  },
                ]}
                testID="add-track-title-input"
                value={title}
                onChangeText={(t) => {
                  editedTitleRef.current = true;
                  setTitle(t);
                }}
              />

              <Text
                style={[styles.label, { color: currentTheme.textSecondary }]}
              >
                Artiste
              </Text>
              <TextInput
                accessibilityLabel="Nom de l'artiste"
                accessibilityHint="Modifiez le nom de l'artiste"
                style={[
                  styles.input,
                  isDark ? styles.bgDarkInput : styles.bgLightInput,
                  {
                    color: currentTheme.text,
                    borderColor: currentTheme.border,
                  },
                ]}
                testID="add-track-artist-input"
                value={artist}
                onChangeText={(t) => {
                  editedArtistRef.current = true;
                  setArtist(t);
                }}
              />

              <Text
                style={[styles.label, { color: currentTheme.textSecondary }]}
              >
                MPM (mesures/min)
              </Text>
              <TextInput
                accessibilityLabel="Cadence en MPM (mesures par minute)"
                accessibilityHint="Modifiez la cadence en MPM"
                style={[
                  styles.input,
                  isDark ? styles.bgDarkInput : styles.bgLightInput,
                  {
                    color: currentTheme.text,
                    borderColor: currentTheme.border,
                  },
                ]}
                value={bpm}
                onChangeText={(t) => {
                  editedBpmRef.current = true;
                  setBpm(t);
                }}
                keyboardType="numeric"
                testID="add-track-bpm-input"
              />

              <Text
                style={[styles.label, { color: currentTheme.textSecondary }]}
              >
                Danse
              </Text>
              {DANCE_GROUPS.map((group) => (
                <View key={group.label}>
                  <Text
                    style={[
                      styles.groupLabel,
                      { color: currentTheme.textSecondary },
                    ]}
                  >
                    {formatDiscipline(group.label)}
                  </Text>
                  <View style={styles.styleGrid}>
                    {group.dances.map((s) => (
                      <TouchableOpacity
                        accessibilityRole="button"
                        key={s}
                        style={[
                          styles.styleChip,
                          isDark ? styles.bgDarkChip : styles.bgLightChip,
                          { borderColor: currentTheme.border },
                          selectedStyle === s && {
                            backgroundColor: currentTheme.primary,
                            borderColor: currentTheme.primary,
                          },
                        ]}
                        onPress={() => {
                          editedStyleRef.current = true;
                          setSelectedStyle(s);
                          applyAutoMpm(s);
                        }}
                      >
                        <Text
                          style={[
                            styles.styleChipText,
                            { color: currentTheme.textSecondary },
                            selectedStyle === s &&
                              (isDark
                                ? styles.textDarkChipActive
                                : styles.textLightChipActive),
                          ]}
                        >
                          {s}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}

              <TouchableOpacity
                accessibilityRole="button"
                style={[
                  styles.button,
                  { backgroundColor: currentTheme.primary },
                ]}
                onPress={() => {
                  handleSave().catch(() => {});
                }}
                testID="add-track-save-button"
              >
                <Text
                  style={[
                    styles.buttonText,
                    isDark ? styles.textDarkButton : styles.textLightButton,
                  ]}
                >
                  Enregistrer les modifications
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.button, styles.deleteButton]}
                onPress={handleDelete}
                testID="add-track-delete-button"
              >
                <Text style={[styles.buttonText, styles.deleteButtonText]}>
                  Supprimer la musique
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
  // flexShrink lets the ScrollView shrink to the space left under the header
  // inside the maxHeight card so its content scrolls (RN default flexShrink is
  // 0 → it would overflow and clip the bottom button).
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 28,
  },
  label: {
    marginBottom: 5,
    marginTop: 10,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 10,
    marginBottom: 2,
    opacity: 0.8,
  },
  input: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  button: {
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 20,
  },
  deleteButton: {
    backgroundColor: "#D32F2F",
    marginTop: 12,
  },
  deleteButtonText: {
    color: "#FFF",
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
  styleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 5,
  },
  styleChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: 1,
  },
  styleChipText: {
    fontSize: 12,
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
