import { BlurView } from "expo-blur";
import { SlidersHorizontal } from "lucide-react-native";
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
import type {
  CreateTrackCorrectionDto,
  TrackCorrectionReason,
} from "../../../services/api/track-correction-api";
import { useCreateTrackCorrection } from "../hooks/useTrackCorrections";
import { ChoiceChip, chipStyles, DanceChips } from "./CorrectionChips";
import {
  CORRECTION_REASONS,
  MESSAGE_MAX_LENGTH,
  MPM_MAX,
  MPM_MIN,
  canonicalDance,
  parseMpm,
  sameDance,
} from "../utils/trackCorrections";

/** Valeurs actuelles de la piste, pour pré-remplir le formulaire. */
export interface CorrectableTrack {
  id: string;
  title: string;
  artist?: string;
  style?: string | null;
  /** MPM actuel. */
  bpm?: number;
}

interface TrackCorrectionModalProps {
  visible: boolean;
  onClose: () => void;
  /** Piste concernée. `null` tant qu'aucune piste n'est sélectionnée. */
  track: CorrectableTrack | null;
  /** Motif présélectionné à l'ouverture. */
  initialReason?: TrackCorrectionReason;
  /**
   * Fourni quand le lecteur peut ouvrir l'éditeur de clashs sur cette piste
   * (paso doble en cours de lecture). Sans lui, on explique où le trouver.
   */
  onProposeClashes?: () => void;
}

export const CORRECTION_SENT_TITLE = "Merci !";
export const CORRECTION_SENT_MESSAGE =
  "Proposition envoyée aux administrateurs.";

/**
 * Proposition de correction d'une piste (titre, artiste, danse, MPM, clashs
 * paso doble, autre). Ouvert à tout utilisateur connecté : les champs sont
 * pré-remplis avec les valeurs actuelles, l'utilisateur corrige et peut
 * ajouter un commentaire. Un administrateur valide ou refuse ensuite.
 */
export const TrackCorrectionModal = ({
  visible,
  onClose,
  track,
  initialReason,
  onProposeClashes,
}: TrackCorrectionModalProps) => {
  const { theme: currentTheme, isDark } = useTheme();
  const createCorrection = useCreateTrackCorrection();

  const [reason, setReason] = useState<TrackCorrectionReason | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [style, setStyle] = useState<string | null>(null);
  const [mpm, setMpm] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (!visible) {
      overlayOpacity.setValue(0);
      cardTranslateY.setValue(20);
      return;
    }
    // Réinitialise le formulaire à chaque ouverture, pré-rempli avec la piste.
    setReason(initialReason ?? null);
    setTitle(track?.title ?? "");
    setArtist(track?.artist ?? "");
    setStyle(canonicalDance(track?.style));
    setMpm(track?.bpm ? String(Math.round(track.bpm)) : "");
    setMessage("");
    setSending(false);
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
    ]).start();
  }, [visible, track, initialReason, overlayOpacity, cardTranslateY]);

  /** Corps de la requête, ou un message d'erreur de saisie. */
  const buildBody = (): CreateTrackCorrectionDto | string => {
    if (!track || !reason) return "Choisissez ce qui est incorrect.";
    const body: CreateTrackCorrectionDto = { trackId: track.id, reason };
    const trimmedMessage = message.trim();
    if (trimmedMessage) body.message = trimmedMessage;

    if (reason === "TITLE") {
      const t = title.trim();
      if (t && t !== track.title) body.title = t;
    } else if (reason === "ARTIST") {
      const a = artist.trim();
      if (a && a !== (track.artist ?? "")) body.artist = a;
    } else if (reason === "DANCE") {
      // Comparaison insensible à la casse, comme le backend.
      if (style && !sameDance(style, track.style)) body.style = style;
    } else if (reason === "MPM" && mpm.trim()) {
      const value = parseMpm(mpm);
      if (value === null) {
        return `Le MPM doit être un nombre entier entre ${MPM_MIN} et ${MPM_MAX}.`;
      }
      if (track.bpm === undefined || value !== Math.round(track.bpm)) {
        body.bpm = value;
      }
    }

    const hasValue =
      body.title !== undefined ||
      body.artist !== undefined ||
      body.style !== undefined ||
      body.bpm !== undefined;
    if (!hasValue && !body.message) {
      return "Modifiez la valeur proposée ou ajoutez un commentaire.";
    }
    return body;
  };

  const handleSubmit = async () => {
    const body = buildBody();
    if (typeof body === "string") {
      Alert.alert("Proposition incomplète", body);
      return;
    }
    setSending(true);
    try {
      await createCorrection.mutateAsync(body);
      Alert.alert(CORRECTION_SENT_TITLE, CORRECTION_SENT_MESSAGE);
      onClose();
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Une erreur est survenue";
      Alert.alert("Envoi impossible", msg);
      setSending(false);
    }
  };

  const inputStyle = [
    styles.input,
    isDark ? styles.bgDarkInput : styles.bgLightInput,
    { color: currentTheme.text, borderColor: currentTheme.border },
  ];

  const renderField = () => {
    switch (reason) {
      case "TITLE":
        return (
          <>
            <Text style={[styles.label, { color: currentTheme.textSecondary }]}>
              Titre correct
            </Text>
            <TextInput
              accessibilityLabel="Titre correct"
              accessibilityHint="Saisissez le bon titre de la musique"
              testID="correction-title-input"
              style={inputStyle}
              value={title}
              onChangeText={setTitle}
              maxLength={255}
            />
          </>
        );
      case "ARTIST":
        return (
          <>
            <Text style={[styles.label, { color: currentTheme.textSecondary }]}>
              Artiste correct
            </Text>
            <TextInput
              accessibilityLabel="Artiste correct"
              accessibilityHint="Saisissez le bon nom d'artiste"
              testID="correction-artist-input"
              style={inputStyle}
              value={artist}
              onChangeText={setArtist}
              maxLength={255}
            />
          </>
        );
      case "DANCE":
        return (
          <>
            <Text style={[styles.label, { color: currentTheme.textSecondary }]}>
              Bonne danse
            </Text>
            <DanceChips
              value={style}
              onChange={setStyle}
              testIDPrefix="correction-dance"
            />
          </>
        );
      case "MPM":
        return (
          <>
            <Text style={[styles.label, { color: currentTheme.textSecondary }]}>
              MPM correct (mesures par minute)
            </Text>
            <TextInput
              accessibilityLabel="MPM correct"
              accessibilityHint="Saisissez le bon tempo en mesures par minute"
              testID="correction-mpm-input"
              style={inputStyle}
              value={mpm}
              onChangeText={setMpm}
              keyboardType="number-pad"
              maxLength={3}
            />
            {track?.bpm ? (
              <Text
                style={[styles.hint, { color: currentTheme.textSecondary }]}
              >
                Valeur actuelle : {Math.round(track.bpm)} MPM
              </Text>
            ) : null}
          </>
        );
      case "PASO_CLASH":
        return (
          <View
            style={[styles.infoBox, { borderColor: currentTheme.border }]}
            testID="correction-clash-info"
          >
            <Text style={[styles.infoText, { color: currentTheme.text }]}>
              Les clashs se placent en écoutant la musique : ouvrez-la dans le
              lecteur puis touchez « Proposer les clashs » sous la barre de
              progression. Vous pouvez aussi décrire le problème ci-dessous.
            </Text>
            {onProposeClashes ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Placer les clashs"
                accessibilityHint="Ouvre l'éditeur des clashs sur la musique en cours"
                testID="correction-open-clash-editor"
                onPress={onProposeClashes}
                style={styles.infoAction}
              >
                <SlidersHorizontal size={16} color={currentTheme.primary} />
                <Text
                  style={[
                    styles.infoActionText,
                    { color: currentTheme.primary },
                  ]}
                >
                  Placer les clashs maintenant
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      default:
        return null;
    }
  };

  const canSubmit = reason !== null;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer la proposition"
          accessibilityHint="Ferme la fenêtre sans envoyer"
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
            { transform: [{ translateY: cardTranslateY }] },
          ]}
        >
          <View
            style={[styles.header, { borderBottomColor: currentTheme.border }]}
          >
            <Text style={[styles.headerTitle, { color: currentTheme.text }]}>
              Proposer une correction
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              accessibilityHint="Ferme la fenêtre de proposition"
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
                <>
                  <Text
                    style={[styles.trackTitle, { color: currentTheme.text }]}
                    numberOfLines={2}
                  >
                    {track.title}
                  </Text>
                  {track.artist ? (
                    <Text
                      style={[
                        styles.trackArtist,
                        { color: currentTheme.textSecondary },
                      ]}
                      numberOfLines={1}
                    >
                      {track.artist}
                    </Text>
                  ) : null}
                </>
              ) : null}

              <Text
                style={[styles.label, { color: currentTheme.textSecondary }]}
              >
                Qu&apos;est-ce qui est incorrect ?
              </Text>
              <View style={chipStyles.grid}>
                {CORRECTION_REASONS.map((r) => (
                  <ChoiceChip
                    key={r.value}
                    label={r.label}
                    selected={reason === r.value}
                    onPress={() => setReason(r.value)}
                    testID={`correction-reason-${r.value}`}
                    accessibilityHint="Sélectionne ce qui est incorrect"
                  />
                ))}
              </View>

              {renderField()}

              <Text
                style={[styles.label, { color: currentTheme.textSecondary }]}
              >
                {reason === "OTHER"
                  ? "Décrivez le problème"
                  : "Commentaire (facultatif)"}
              </Text>
              <TextInput
                accessibilityLabel="Commentaire pour les administrateurs"
                accessibilityHint="Ajoutez des précisions pour les administrateurs"
                style={[...inputStyle, styles.multiline]}
                testID="correction-message-input"
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={MESSAGE_MAX_LENGTH}
                placeholder="Ex. source, version de la musique…"
                placeholderTextColor={currentTheme.textSecondary}
              />

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Envoyer la proposition"
                accessibilityHint="Envoie la proposition aux administrateurs pour validation"
                accessibilityState={{ disabled: !canSubmit }}
                disabled={!canSubmit}
                style={[
                  styles.button,
                  {
                    backgroundColor: canSubmit
                      ? currentTheme.primary
                      : currentTheme.border,
                  },
                ]}
                onPress={() => {
                  handleSubmit().catch(() => {});
                }}
                testID="correction-submit-button"
              >
                <Text
                  style={[
                    styles.buttonText,
                    isDark ? styles.textDarkButton : styles.textLightButton,
                  ]}
                >
                  Envoyer la proposition
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
    maxHeight: "85%",
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
  // flexShrink : le ScrollView rétrécit sous l'en-tête dans la carte bornée
  // par maxHeight, sinon il déborde et masque le bouton du bas.
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
  },
  trackArtist: {
    fontSize: 14,
    marginTop: 2,
    marginBottom: 6,
  },
  label: {
    marginBottom: 5,
    marginTop: 14,
  },
  hint: {
    fontSize: 12,
    marginTop: 4,
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
  infoBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
  infoAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
  },
  infoActionText: {
    fontWeight: "600",
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
  textDarkButton: { color: "#000" },
  textLightButton: { color: "#FFF" },
});
