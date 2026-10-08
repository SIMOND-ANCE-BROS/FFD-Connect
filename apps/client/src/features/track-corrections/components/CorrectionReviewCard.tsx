import { ArrowRight, Pencil } from "lucide-react-native";
import React, { useState } from "react";
import {
  Alert,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import {
  TrackCorrectionApiError,
  type ApproveTrackCorrectionDto,
  type TrackCorrectionAdminDto,
} from "../../../services/api/track-correction-api";
import { useReviewTrackCorrection } from "../hooks/useTrackCorrections";
import {
  buildCorrectionDiff,
  CLASH_MAX_COUNT,
  formatClashListForEdit,
  formatCorrectionDate,
  isDanceOnlyChange,
  MESSAGE_MAX_LENGTH,
  MPM_MAX,
  MPM_MIN,
  parseClashList,
  parseMpm,
  reasonLabel,
  sameClashes,
  sameDance,
} from "../utils/trackCorrections";
import { DanceChips, StatusBadge } from "./CorrectionChips";

interface CorrectionReviewCardProps {
  item: TrackCorrectionAdminDto;
  /** Mise en avant (ouverte depuis une notification). */
  focused?: boolean;
  /**
   * Appelé quand la proposition est tranchée (par cet admin, ou déjà par un
   * autre : 409). Permet à la file de la retirer sans attendre le rechargement.
   */
  onDecided?: (id: string) => void;
}

interface Draft {
  title: string;
  artist: string;
  style: string | null;
  bpm: string;
  clashes: string;
}

const draftOf = (item: TrackCorrectionAdminDto): Draft => ({
  title: item.proposed.title ?? "",
  artist: item.proposed.artist ?? "",
  style: item.proposed.style,
  bpm: item.proposed.bpm !== null ? String(item.proposed.bpm) : "",
  // m:ss.d : les dixièmes ne doivent pas être perdus à l'édition.
  clashes:
    item.proposed.clashTimecodes !== null
      ? formatClashListForEdit(item.proposed.clashTimecodes)
      : "",
});

/**
 * Ajustements de l'admin : uniquement les champs proposés qu'il a modifiés.
 * Renvoie un message d'erreur si une saisie est invalide.
 *
 * `keepCurrentBpm` : sur un changement de danse seul, le backend recalcule le
 * MPM ; l'admin peut au contraire conserver le MPM actuel de la piste.
 */
export function buildApproveOverrides(
  item: TrackCorrectionAdminDto,
  draft: Draft,
  keepCurrentBpm = false,
): Omit<ApproveTrackCorrectionDto, "comment"> | string {
  const initial = draftOf(item);
  const body: Omit<ApproveTrackCorrectionDto, "comment"> = {};
  const { proposed } = item;
  if (keepCurrentBpm && isDanceOnlyChange(item)) {
    body.bpm = item.track.bpm;
  }
  if (proposed.title !== null && draft.title !== initial.title) {
    const t = draft.title.trim();
    if (!t) return "Le titre ne peut pas être vide.";
    body.title = t;
  }
  if (proposed.artist !== null && draft.artist !== initial.artist) {
    const a = draft.artist.trim();
    if (!a) return "L'artiste ne peut pas être vide.";
    body.artist = a;
  }
  if (
    proposed.style !== null &&
    draft.style &&
    !sameDance(draft.style, initial.style)
  ) {
    body.style = draft.style;
  }
  if (proposed.bpm !== null && draft.bpm !== initial.bpm) {
    const n = parseMpm(draft.bpm);
    if (n === null) {
      return `Le MPM doit être un nombre entier entre ${MPM_MIN} et ${MPM_MAX}.`;
    }
    body.bpm = n;
  }
  if (proposed.clashTimecodes !== null) {
    const clashes = parseClashList(draft.clashes);
    if (clashes === null) {
      return `Clashs illisibles : saisissez des temps « m:ss » séparés par des virgules (${CLASH_MAX_COUNT} au plus).`;
    }
    // N'envoyer que si la liste diffère réellement de la proposition.
    if (!sameClashes(clashes, proposed.clashTimecodes)) {
      body.clashTimecodes = clashes;
    }
  }
  return body;
}

/**
 * Carte d'une proposition dans la file de modération : musique, auteur, date,
 * motif, diff « actuel → proposé » champ par champ, commentaire de l'auteur.
 * Si elle est en attente, l'admin peut ajuster les valeurs, commenter, puis
 * valider ou refuser.
 */
export const CorrectionReviewCard = ({
  item,
  focused = false,
  onDecided,
}: CorrectionReviewCardProps) => {
  const { theme } = useTheme();
  const review = useReviewTrackCorrection();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  const [comment, setComment] = useState("");
  const [keepCurrentBpm, setKeepCurrentBpm] = useState(false);

  const isPending = item.status === "PENDING";
  const diff = buildCorrectionDiff(item);
  const hasEditable = diff.some((line) => line.field !== "resultingBpm");
  const danceOnly = isDanceOnlyChange(item);
  const busy = review.isPending;

  const handleError = (error: unknown) => {
    if (error instanceof TrackCorrectionApiError && error.status === 409) {
      onDecided?.(item.id);
      Alert.alert(
        "Déjà traitée",
        "Cette proposition a déjà été traitée par un autre administrateur. La liste a été actualisée.",
      );
      return;
    }
    Alert.alert(
      "Erreur",
      error instanceof Error ? error.message : "Une erreur est survenue",
    );
  };

  const submit = (decision: "approve" | "reject") => {
    const trimmed = comment.trim();
    if (decision === "reject") {
      review
        .mutateAsync({
          id: item.id,
          decision: "reject",
          comment: trimmed || undefined,
        })
        .then(() => {
          onDecided?.(item.id);
          Alert.alert("Proposition refusée", "L'auteur est prévenu.");
        })
        .catch(handleError);
      return;
    }
    const overrides = buildApproveOverrides(
      item,
      editing ? draft : draftOf(item),
      keepCurrentBpm,
    );
    if (typeof overrides === "string") {
      Alert.alert("Valeurs invalides", overrides);
      return;
    }
    review
      .mutateAsync({
        id: item.id,
        decision: "approve",
        body: { ...overrides, ...(trimmed ? { comment: trimmed } : {}) },
      })
      .then(() => {
        onDecided?.(item.id);
        Alert.alert(
          "Proposition validée",
          "La musique est corrigée et l'auteur est prévenu.",
        );
      })
      .catch(handleError);
  };

  const confirm = (decision: "approve" | "reject") => {
    Alert.alert(
      decision === "approve"
        ? "Valider la proposition ?"
        : "Refuser la proposition ?",
      decision === "approve"
        ? "Les valeurs proposées seront appliquées à la musique."
        : "La musique restera inchangée.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: decision === "approve" ? "Valider" : "Refuser",
          style: decision === "approve" ? "default" : "destructive",
          onPress: () => submit(decision),
        },
      ],
    );
  };

  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.border },
  ];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        focused && { borderColor: theme.primary, borderWidth: 2 },
      ]}
      testID={`correction-card-${item.id}`}
    >
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <AppText variant="body" weight="bold" color={theme.text}>
            {item.track.title}
          </AppText>
          <AppText variant="caption" color={theme.textSecondary}>
            {item.track.artist}
            {item.track.titleMasked ? " · titre masqué" : ""}
            {item.track.blacklisted ? " · retirée" : ""}
          </AppText>
        </View>
        <StatusBadge status={item.status} />
      </View>

      <AppText
        variant="caption"
        color={theme.textSecondary}
        style={styles.meta}
      >
        {reasonLabel(item.reason)} · {item.proposer?.name ?? "Compte supprimé"}{" "}
        · {formatCorrectionDate(item.createdAt)}
      </AppText>

      {diff.map((line) => (
        <View key={line.field} style={styles.diffRow}>
          <AppText variant="caption" weight="bold" color={theme.textSecondary}>
            {line.label}
          </AppText>
          <View style={styles.diffValues}>
            <AppText
              variant="body"
              color={theme.textSecondary}
              style={styles.strike}
            >
              {line.current}
            </AppText>
            <ArrowRight size={14} color={theme.textSecondary} />
            <AppText
              variant="body"
              weight="600"
              color={theme.text}
              style={styles.flex}
            >
              {line.proposed}
            </AppText>
          </View>
        </View>
      ))}

      {item.message ? (
        <View style={[styles.quote, { borderLeftColor: theme.border }]}>
          <AppText variant="caption" color={theme.textSecondary}>
            Commentaire de l&apos;auteur
          </AppText>
          <AppText variant="body" color={theme.text}>
            {item.message}
          </AppText>
        </View>
      ) : null}

      {!isPending && (
        <View style={[styles.quote, { borderLeftColor: theme.border }]}>
          <AppText variant="caption" color={theme.textSecondary}>
            {item.status === "APPROVED" ? "Validée" : "Refusée"} par{" "}
            {item.reviewer?.name ?? "un administrateur"}
            {item.reviewedAt
              ? ` le ${formatCorrectionDate(item.reviewedAt)}`
              : ""}
          </AppText>
          {item.reviewComment ? (
            <AppText variant="body" color={theme.text}>
              {item.reviewComment}
            </AppText>
          ) : null}
        </View>
      )}

      {isPending && (
        <>
          {hasEditable && !editing && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Ajuster les valeurs proposées"
              accessibilityHint="Permet de corriger les valeurs avant de valider"
              testID={`correction-adjust-${item.id}`}
              onPress={() => setEditing(true)}
              style={styles.adjust}
            >
              <Pencil size={14} color={theme.primary} />
              <AppText variant="caption" weight="bold" color={theme.primary}>
                Ajuster les valeurs
              </AppText>
            </TouchableOpacity>
          )}

          {editing && (
            <View style={styles.editor}>
              {item.proposed.title !== null && (
                <TextInput
                  accessibilityLabel="Titre à appliquer"
                  accessibilityHint="Ajustez le titre avant validation"
                  testID={`correction-edit-title-${item.id}`}
                  style={inputStyle}
                  value={draft.title}
                  onChangeText={(title) => setDraft((d) => ({ ...d, title }))}
                  maxLength={255}
                />
              )}
              {item.proposed.artist !== null && (
                <TextInput
                  accessibilityLabel="Artiste à appliquer"
                  accessibilityHint="Ajustez l'artiste avant validation"
                  testID={`correction-edit-artist-${item.id}`}
                  style={inputStyle}
                  value={draft.artist}
                  onChangeText={(artist) => setDraft((d) => ({ ...d, artist }))}
                  maxLength={255}
                />
              )}
              {item.proposed.style !== null && (
                <DanceChips
                  value={draft.style}
                  onChange={(style) => setDraft((d) => ({ ...d, style }))}
                  testIDPrefix={`correction-edit-dance-${item.id}`}
                />
              )}
              {item.proposed.bpm !== null && (
                <TextInput
                  accessibilityLabel="MPM à appliquer"
                  accessibilityHint="Ajustez le tempo avant validation"
                  testID={`correction-edit-bpm-${item.id}`}
                  style={inputStyle}
                  value={draft.bpm}
                  onChangeText={(bpm) => setDraft((d) => ({ ...d, bpm }))}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              )}
              {item.proposed.clashTimecodes !== null && (
                <TextInput
                  accessibilityLabel="Clashs à appliquer"
                  accessibilityHint="Temps m:ss séparés par des virgules"
                  testID={`correction-edit-clashes-${item.id}`}
                  style={inputStyle}
                  value={draft.clashes}
                  onChangeText={(clashes) =>
                    setDraft((d) => ({ ...d, clashes }))
                  }
                  placeholder="ex. 0:40, 1:20, 2:00"
                  placeholderTextColor={theme.textSecondary}
                />
              )}
            </View>
          )}

          {danceOnly && (
            <View style={styles.toggleRow}>
              <AppText variant="caption" color={theme.text} style={styles.flex}>
                Garder le MPM actuel ({Math.round(item.track.bpm)})
              </AppText>
              <Switch
                accessibilityLabel="Garder le MPM actuel"
                accessibilityHint="Conserve le MPM de la musique au lieu de le recalculer pour la nouvelle danse"
                testID={`correction-keep-bpm-${item.id}`}
                value={keepCurrentBpm}
                onValueChange={setKeepCurrentBpm}
              />
            </View>
          )}

          <TextInput
            accessibilityLabel="Commentaire pour l'auteur"
            accessibilityHint="Message transmis à l'auteur avec la décision (facultatif)"
            testID={`correction-comment-${item.id}`}
            style={[...inputStyle, styles.multiline]}
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder="Commentaire pour l'auteur (facultatif)"
            placeholderTextColor={theme.textSecondary}
          />

          <View style={styles.actions}>
            <View style={styles.flex}>
              <AppButton
                title="Refuser"
                variant="secondary"
                onPress={() => confirm("reject")}
                disabled={busy}
                testID={`correction-reject-${item.id}`}
                accessibilityLabel="Refuser la proposition"
                accessibilityHint="Refuse la proposition, la musique reste inchangée"
              />
            </View>
            <View style={styles.spacer} />
            <View style={styles.flex}>
              <AppButton
                title="Valider"
                onPress={() => confirm("approve")}
                disabled={busy}
                loading={busy}
                testID={`correction-approve-${item.id}`}
                accessibilityLabel="Valider la proposition"
                accessibilityHint="Applique les valeurs proposées à la musique"
              />
            </View>
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  flex: { flex: 1 },
  meta: { marginTop: 6, marginBottom: 4 },
  diffRow: { marginTop: 8 },
  diffValues: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  strike: { textDecorationLine: "line-through" },
  quote: {
    marginTop: 10,
    paddingLeft: 10,
    borderLeftWidth: 3,
  },
  adjust: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 4,
  },
  editor: { marginTop: 8, gap: 8 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  multiline: {
    marginTop: 12,
    minHeight: 56,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", marginTop: 12 },
  spacer: { width: 12 },
});
