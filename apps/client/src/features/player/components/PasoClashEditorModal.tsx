import { Pause, Play, Plus, Trash2, Wand2 } from "lucide-react-native";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { BackendService } from "../../../services/BackendService";
import { createLogger } from "../../../utils/logger";
import { formatTime } from "./audio-player.styles";
import {
  computeDefaultPasoClashes,
  getEffectiveClashes,
} from "../utils/pasoClashes";

const logger = createLogger("PasoClashEditor");

interface PasoClashEditorModalProps {
  visible: boolean;
  trackId: string;
  style?: string;
  clashTimecodes?: number[];
  /** Position/durée de lecture en direct (secondes). */
  position: number;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  /** Appelé après sauvegarde réussie avec la nouvelle liste (pour rafraîchir les marqueurs). */
  onSaved: (clashes: number[]) => void;
}

/**
 * Éditeur admin des appels/coups paso doble (#paso-clashes).
 * On écoute la piste en cours et on « pose un point » à la position voulue ;
 * bouton calcul auto (estimation depuis la durée), suppression, sauvegarde.
 */
export const PasoClashEditorModal = ({
  visible,
  trackId,
  style,
  clashTimecodes,
  position,
  duration,
  isPlaying,
  onTogglePlay,
  onSeek,
  onClose,
  onSaved,
}: PasoClashEditorModalProps) => {
  const { theme } = useTheme();
  const [points, setPoints] = useState<number[]>(() =>
    getEffectiveClashes(style, clashTimecodes, duration),
  );
  const [saving, setSaving] = useState(false);

  const addPoint = () => {
    const t = Math.round(position * 10) / 10;
    setPoints((prev) =>
      prev.includes(t) ? prev : [...prev, t].sort((a, b) => a - b),
    );
  };

  const removePoint = (t: number) => {
    setPoints((prev) => prev.filter((p) => p !== t));
  };

  const autoCompute = () => {
    setPoints(computeDefaultPasoClashes(duration));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await BackendService.updateTrack(trackId, { clashTimecodes: points });
      onSaved(points);
      onClose();
    } catch (e) {
      logger.error("Failed to save paso clashes", e);
      Alert.alert("Erreur", "La sauvegarde des appels a échoué.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer l'éditeur"
        accessibilityHint="Ferme l'éditeur des appels sans enregistrer"
      >
        <Pressable
          style={[styles.card, { backgroundColor: theme.surface }]}
          onPress={() => {}}
          accessibilityRole="none"
        >
          <AppText variant="h3" color={theme.text} style={styles.title}>
            Appels du paso doble
          </AppText>
          <AppText variant="caption" color={theme.textSecondary}>
            Écoute le morceau et pose un point à chaque appel. Position actuelle
            : {formatTime(position)} / {formatTime(duration)}
          </AppText>

          {/* Transport minimal */}
          <View style={styles.transport}>
            <TouchableOpacity
              onPress={() => onSeek(Math.max(0, position - 2))}
              accessibilityRole="button"
              accessibilityLabel="Reculer de 2 secondes"
              accessibilityHint="Recule la lecture de 2 secondes"
              style={[styles.seekBtn, { borderColor: theme.border }]}
            >
              <AppText variant="caption" color={theme.text}>
                −2s
              </AppText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onTogglePlay}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? "Pause" : "Lecture"}
              accessibilityHint="Bascule lecture / pause du morceau"
              style={[styles.playBtn, { backgroundColor: theme.primary }]}
            >
              {isPlaying ? (
                <Pause size={20} color="#fff" />
              ) : (
                <Play size={20} color="#fff" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onSeek(Math.min(duration, position + 2))}
              accessibilityRole="button"
              accessibilityLabel="Avancer de 2 secondes"
              accessibilityHint="Avance la lecture de 2 secondes"
              style={[styles.seekBtn, { borderColor: theme.border }]}
            >
              <AppText variant="caption" color={theme.text}>
                +2s
              </AppText>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={addPoint}
            accessibilityRole="button"
            accessibilityLabel="Poser un point à la position actuelle"
            accessibilityHint="Ajoute un appel au timecode courant"
            testID="paso-add-point"
            style={[styles.addRow, { backgroundColor: `${theme.warning}22` }]}
          >
            <Plus size={18} color={theme.warning} />
            <AppText
              variant="body"
              color={theme.warning}
              style={styles.addText}
            >
              Poser un appel à {formatTime(position)}
            </AppText>
          </TouchableOpacity>

          <ScrollView style={styles.list} testID="paso-points-list">
            {points.length === 0 ? (
              <AppText
                variant="caption"
                color={theme.textSecondary}
                align="center"
                style={styles.empty}
              >
                Aucun appel. Pose un point ou utilise le calcul auto.
              </AppText>
            ) : (
              points.map((t, i) => (
                <View
                  key={`${t}-${i}`}
                  style={[styles.pointRow, { borderBottomColor: theme.border }]}
                >
                  <AppText variant="body" color={theme.text}>
                    Appel {i + 1} — {formatTime(t)}
                  </AppText>
                  <TouchableOpacity
                    onPress={() => removePoint(t)}
                    accessibilityRole="button"
                    accessibilityLabel={`Supprimer l'appel ${i + 1}`}
                    accessibilityHint="Retire cet appel de la liste"
                    testID={`paso-remove-point-${i}`}
                  >
                    <Trash2 size={18} color="#e74c3c" />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>

          <TouchableOpacity
            onPress={autoCompute}
            accessibilityRole="button"
            accessibilityLabel="Calcul automatique des appels"
            accessibilityHint="Remplit les appels avec une estimation depuis la durée"
            testID="paso-auto-compute"
            style={styles.autoRow}
          >
            <Wand2 size={16} color={theme.primary} />
            <AppText
              variant="caption"
              color={theme.primary}
              style={styles.addText}
            >
              Calcul auto (estimation)
            </AppText>
          </TouchableOpacity>

          <View style={styles.actions}>
            <AppButton
              title="Annuler"
              variant="secondary"
              onPress={onClose}
              disabled={saving}
            />
            <View style={styles.spacer} />
            <AppButton
              title={saving ? "Sauvegarde…" : "Enregistrer"}
              onPress={() => {
                handleSave().catch(() => {});
              }}
              disabled={saving}
              testID="paso-save"
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  card: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    maxHeight: "82%",
  },
  title: { marginBottom: 4 },
  transport: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginVertical: 14,
  },
  seekBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  addText: { fontWeight: "600" },
  list: { marginTop: 12, maxHeight: 200 },
  empty: { paddingVertical: 20 },
  pointRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  autoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  actions: { flexDirection: "row", marginTop: 8 },
  spacer: { width: 12 },
});
