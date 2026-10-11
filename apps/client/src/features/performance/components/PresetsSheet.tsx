import { X } from "lucide-react-native";
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { radii } from "../../../constants/radii";
import { useTheme } from "../../../context/ThemeContext";
import {
  findPresetByName,
  MAX_PRESETS,
  PRESET_NAME_MAX_LENGTH,
  type CompetitionPreset,
  type SaveResult,
} from "../../../stores/competitionPresets.store";

interface PresetsSheetProps {
  visible: boolean;
  presets: readonly CompetitionPreset[];
  activePresetId: string | null;
  onClose: () => void;
  /** Loads the preset into the live programme. */
  onLoad: (preset: CompetitionPreset) => void;
  /** Saves the live programme under a new name. */
  onSave: (name: string) => SaveResult;
  /** Replaces the programme of an existing preset with the live one. */
  onReplace: (id: string) => void;
  onRename: (id: string, name: string) => SaveResult;
  onDelete: (id: string) => void;
}

type Form = { kind: "save" } | { kind: "rename"; id: string };

const ERRORS = {
  empty: "Donnez un nom au preset.",
  full: `${MAX_PRESETS} presets maximum : supprimez-en un pour en enregistrer un nouveau.`,
  renameDuplicate: "Un autre preset porte déjà ce nom.",
} as const;

/** « 11/10/2026 » — local day of an ISO timestamp ("" when invalid). */
export const formatPresetDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};

interface RowButtonProps {
  text: string;
  label: string;
  hint: string;
  color: string;
  testID: string;
  onPress: () => void;
}

const RowButton = ({
  text,
  label,
  hint,
  color,
  testID,
  onPress,
}: RowButtonProps) => (
  <TouchableOpacity
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint={hint}
    hitSlop={6}
    testID={testID}
    style={styles.rowButton}
  >
    <AppText variant="caption" weight="600" color={color}>
      {text}
    </AppText>
  </TouchableOpacity>
);

/**
 * Bottom sheet of the competition presets: load, rename or delete a saved
 * programme, or save the live one under a name. Presentational — the screen
 * owns the store and the live programme.
 */
export const PresetsSheet: React.FC<PresetsSheetProps> = ({
  visible,
  presets,
  activePresetId,
  onClose,
  onLoad,
  onSave,
  onReplace,
  onRename,
  onDelete,
}) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<Form | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const closeForm = () => {
    setForm(null);
    setName("");
    setError(null);
  };

  const close = () => {
    closeForm();
    onClose();
  };

  const openForm = (next: Form, initialName: string) => {
    setForm(next);
    setName(initialName);
    setError(null);
  };

  const confirmReplace = (existing: CompetitionPreset) =>
    Alert.alert(
      "Remplacer ?",
      `Un preset « ${existing.name} » existe déjà. Le remplacer par le programme actuel ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Remplacer",
          style: "destructive",
          onPress: () => {
            onReplace(existing.id);
            closeForm();
          },
        },
      ],
    );

  const confirmDelete = (preset: CompetitionPreset) =>
    Alert.alert(
      "Supprimer le preset",
      `Supprimer « ${preset.name} » ? Le programme affiché n'est pas modifié.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () => onDelete(preset.id),
        },
      ],
    );

  const submit = () => {
    if (!form) return;
    if (form.kind === "rename") {
      const result = onRename(form.id, name);
      if (result.ok) closeForm();
      else
        setError(
          result.reason === "empty" ? ERRORS.empty : ERRORS.renameDuplicate,
        );
      return;
    }
    const result = onSave(name);
    if (result.ok) {
      closeForm();
      return;
    }
    if (result.reason === "duplicate") {
      const existing = findPresetByName(presets, name);
      if (existing) confirmReplace(existing);
      return;
    }
    setError(result.reason === "empty" ? ERRORS.empty : ERRORS.full);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Sibling of the card, not its parent: a Pressable parent would
            collapse into one VoiceOver element and hide the controls. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          testID="performance-presets-backdrop"
          accessibilityRole="button"
          accessibilityLabel="Fermer les presets"
          accessibilityHint="Ferme la liste des presets"
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.surface,
              paddingBottom: Math.max(insets.bottom + 12, 28),
            },
          ]}
        >
          <View style={styles.header}>
            <AppText variant="h3" color={theme.text} style={styles.title}>
              Presets
            </AppText>
            <TouchableOpacity
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              accessibilityHint="Ferme la liste des presets"
              hitSlop={12}
              testID="performance-presets-close"
            >
              <X size={22} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {presets.length === 0 && (
              <AppText
                variant="caption"
                color={theme.textSecondary}
                testID="performance-presets-empty"
              >
                Aucun preset enregistré. Enregistrez le programme actuel pour le
                retrouver en un geste.
              </AppText>
            )}
            {presets.map((preset) => {
              const active = preset.id === activePresetId;
              const prefix = `performance-preset-${preset.id}`;
              return (
                <View
                  key={preset.id}
                  testID={prefix}
                  style={[
                    styles.row,
                    { borderColor: active ? theme.primary : theme.border },
                  ]}
                >
                  <View style={styles.rowText}>
                    <AppText variant="body" weight="600" color={theme.text}>
                      {preset.name}
                    </AppText>
                    <AppText variant="caption" color={theme.textSecondary}>
                      {active ? "En cours · " : ""}Enregistré le{" "}
                      {formatPresetDate(preset.updatedAt)}
                    </AppText>
                  </View>
                  <View style={styles.rowActions}>
                    <RowButton
                      text="Charger"
                      label={`Charger le preset ${preset.name}`}
                      hint="Remplace le programme affiché par ce preset"
                      color={theme.primary}
                      testID={`${prefix}-load`}
                      onPress={() => {
                        onLoad(preset);
                        close();
                      }}
                    />
                    <RowButton
                      text="Renommer"
                      label={`Renommer le preset ${preset.name}`}
                      hint="Change le nom de ce preset"
                      color={theme.text}
                      testID={`${prefix}-rename`}
                      onPress={() =>
                        openForm({ kind: "rename", id: preset.id }, preset.name)
                      }
                    />
                    <RowButton
                      text="Supprimer"
                      label={`Supprimer le preset ${preset.name}`}
                      hint="Supprime ce preset après confirmation"
                      color={theme.danger}
                      testID={`${prefix}-delete`}
                      onPress={() => confirmDelete(preset)}
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {form ? (
            <View style={styles.form}>
              <AppText variant="caption" color={theme.textSecondary}>
                {form.kind === "save" ? "Nom du preset" : "Nouveau nom"}
              </AppText>
              <TextInput
                testID="performance-presets-name-input"
                accessibilityLabel="Nom du preset"
                accessibilityHint={`${PRESET_NAME_MAX_LENGTH} caractères maximum`}
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setError(null);
                }}
                maxLength={PRESET_NAME_MAX_LENGTH}
                autoFocus
                placeholder="Ex. Championnat de France"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
                onSubmitEditing={submit}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.background,
                  },
                ]}
              />
              {error && (
                <AppText
                  variant="caption"
                  color={theme.danger}
                  testID="performance-presets-error"
                  accessibilityLiveRegion="polite"
                >
                  {error}
                </AppText>
              )}
              <View style={styles.formActions}>
                <AppButton
                  title="Annuler"
                  variant="secondary"
                  onPress={closeForm}
                  style={styles.formButton}
                  testID="performance-presets-form-cancel"
                  accessibilityLabel="Annuler"
                  accessibilityHint="Ferme le formulaire sans rien enregistrer"
                />
                <AppButton
                  title={form.kind === "save" ? "Enregistrer" : "Renommer"}
                  onPress={submit}
                  style={styles.formButton}
                  testID="performance-presets-form-confirm"
                  accessibilityLabel={
                    form.kind === "save"
                      ? "Enregistrer le preset"
                      : "Renommer le preset"
                  }
                  accessibilityHint={
                    form.kind === "save"
                      ? "Enregistre le programme actuel sous ce nom"
                      : "Donne ce nom au preset"
                  }
                />
              </View>
            </View>
          ) : (
            <AppButton
              title="Enregistrer le programme actuel"
              variant="outline"
              onPress={() => openForm({ kind: "save" }, "")}
              style={styles.saveButton}
              testID="performance-presets-save"
              accessibilityLabel="Enregistrer le programme actuel"
              accessibilityHint="Enregistre le programme configuré sous un nom"
            />
          )}
        </View>
      </KeyboardAvoidingView>
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
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: "92%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: { flex: 1 },
  body: { flexShrink: 1 },
  row: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  rowText: { gap: 2 },
  rowActions: { flexDirection: "row", gap: 16 },
  rowButton: { minHeight: 44, justifyContent: "center" },
  form: { marginTop: 12, gap: 8 },
  input: {
    padding: 12,
    borderRadius: radii.md,
    fontSize: 16,
    borderWidth: 1,
  },
  formActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  formButton: { flex: 1 },
  saveButton: { marginTop: 12 },
});
