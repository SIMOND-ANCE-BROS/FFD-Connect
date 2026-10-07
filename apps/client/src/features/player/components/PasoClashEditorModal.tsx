import { Pause, Play, Plus, Trash2, Wand2 } from "lucide-react-native";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { BackendService } from "../../../services/BackendService";
import { createLogger } from "../../../utils/logger";
import {
  CORRECTION_SENT_MESSAGE,
  CORRECTION_SENT_TITLE,
} from "../../track-corrections/components/TrackCorrectionModal";
import { useCreateTrackCorrection } from "../../track-corrections/hooks/useTrackCorrections";
import {
  CLASH_MAX_COUNT,
  MESSAGE_MAX_LENGTH,
} from "../../track-corrections/utils/trackCorrections";
import { formatTime } from "./audio-player.styles";
import {
  computeDefaultPasoClashes,
  getEffectiveClashes,
} from "../utils/pasoClashes";

const logger = createLogger("PasoClashEditor");

/**
 * `edit` : un admin enregistre directement les appels sur la piste.
 * `propose` : tout utilisateur connecté soumet sa proposition aux admins.
 */
export type PasoClashEditorMode = "edit" | "propose";

interface PasoClashEditorModalProps {
  visible: boolean;
  /** `edit` par défaut. */
  mode?: PasoClashEditorMode;
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
  /** Mode `edit` : appelé après sauvegarde avec la nouvelle liste (pour rafraîchir les marqueurs). */
  onSaved?: (clashes: number[]) => void;
}

/**
 * Éditeur des appels/coups paso doble (#paso-clashes).
 * On écoute la piste en cours et on « pose un point » à la position voulue ;
 * bouton calcul auto (estimation depuis la durée), suppression, puis
 * sauvegarde (admin) ou proposition aux administrateurs (autres utilisateurs).
 */
export const PasoClashEditorModal = ({
  visible,
  mode = "edit",
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
  const [comment, setComment] = useState("");
  const createCorrection = useCreateTrackCorrection();
  const isPropose = mode === "propose";

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
      onSaved?.(points);
      onClose();
    } catch (e) {
      logger.error("Failed to save paso clashes", e);
      Alert.alert("Erreur", "La sauvegarde des appels a échoué.");
    } finally {
      setSaving(false);
    }
  };

  const handlePropose = async () => {
    if (points.length > CLASH_MAX_COUNT) {
      Alert.alert(
        "Trop d'appels",
        `Proposez au plus ${CLASH_MAX_COUNT} appels.`,
      );
      return;
    }
    setSaving(true);
    try {
      const message = comment.trim();
      await createCorrection.mutateAsync({
        trackId,
        reason: "PASO_CLASH",
        clashTimecodes: points,
        ...(message ? { message } : {}),
      });
      Alert.alert(CORRECTION_SENT_TITLE, CORRECTION_SENT_MESSAGE);
      onClose();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "L'envoi de la proposition a échoué.";
      Alert.alert("Envoi impossible", msg);
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
            {isPropose ? "Proposer les appels" : "Appels du paso doble"}
          </AppText>
          <AppText variant="caption" color={theme.textSecondary}>
            Écoute le morceau et pose un point à chaque appel.
            {isPropose
              ? " Ta proposition sera validée par un administrateur."
              : ""}{" "}
            Position actuelle : {formatTime(position)} / {formatTime(duration)}
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

          {isPropose && (
            <TextInput
              accessibilityLabel="Commentaire pour les administrateurs"
              accessibilityHint="Ajoute des précisions à ta proposition (facultatif)"
              testID="paso-propose-comment"
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={MESSAGE_MAX_LENGTH}
              placeholder="Commentaire (facultatif)"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.comment,
                { color: theme.text, borderColor: theme.border },
              ]}
            />
          )}

          <View style={styles.actions}>
            <AppButton
              title="Annuler"
              variant="secondary"
              onPress={onClose}
              disabled={saving}
            />
            <View style={styles.spacer} />
            {isPropose ? (
              <AppButton
                title={saving ? "Envoi…" : "Proposer"}
                onPress={() => {
                  handlePropose().catch(() => {});
                }}
                disabled={saving}
                testID="paso-propose"
                accessibilityLabel="Envoyer la proposition d'appels"
                accessibilityHint="Envoie les appels placés aux administrateurs pour validation"
              />
            ) : (
              <AppButton
                title={saving ? "Sauvegarde…" : "Enregistrer"}
                onPress={() => {
                  handleSave().catch(() => {});
                }}
                disabled={saving}
                testID="paso-save"
              />
            )}
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
  comment: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    minHeight: 56,
    textAlignVertical: "top",
    marginBottom: 4,
  },
  actions: { flexDirection: "row", marginTop: 8 },
  spacer: { width: 12 },
});
