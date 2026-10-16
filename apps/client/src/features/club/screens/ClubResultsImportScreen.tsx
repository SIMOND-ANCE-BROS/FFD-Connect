import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { announce } from "../../../utils/announce";
import { useResultsImport } from "../hooks/useResultsImport";
import { MAX_RESULTS_CSV_LENGTH } from "../services/resultsImportApi";
import {
  formatLineError,
  formatPreview,
  RESULTS_CSV_COLUMNS,
  reportRows,
} from "../utils/resultsImport";

type Props = NativeStackScreenProps<RootStackParamList, "ClubResultsImport">;

const numberFormatter = new Intl.NumberFormat("fr-FR");

/**
 * Import of the published results of a competition by its organising club
 * (#690). The club pastes the CSV, checks it (dry run, nothing written) and
 * only then imports the very same text. File picking is not offered: the app
 * ships no document picker (a new native module would need a native build).
 */
export const ClubResultsImportScreen = ({ navigation, route }: Props) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 80);
  const { competitionId, competitionTitle } = route.params;
  const {
    csv,
    setCsv,
    check,
    confirmImport,
    preview,
    report,
    failure,
    busy,
    tooLarge,
    canCheck,
    canImport,
  } = useResultsImport(competitionId);

  // Inline feedback is only visual: read it out to the screen reader too.
  useEffect(() => {
    if (failure) {
      announce(
        failure.errors.length > 0
          ? `${failure.message} ${failure.errors.length} ligne(s) en erreur.`
          : failure.message,
      );
    }
  }, [failure]);
  useEffect(() => {
    if (preview) announce(formatPreview(preview));
  }, [preview]);
  useEffect(() => {
    if (report) announce("Import terminé.");
  }, [report]);

  const pasteFromClipboard = () => {
    Clipboard.getStringAsync()
      .then((text) => {
        if (text) setCsv(text);
      })
      .catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerH, paddingBottom: insets.bottom + 32 },
        ]}
        testID="results-import-scroll"
      >
        {competitionTitle ? (
          <AppText variant="h3" style={styles.mb8} accessibilityRole="header">
            {competitionTitle}
          </AppText>
        ) : null}
        <AppText variant="body" color={theme.textSecondary} style={styles.mb16}>
          Collez le classement publié au format CSV (exporté depuis votre
          tableur, une ligne par couple, par épreuve et par tour). Vérifiez-le
          d'abord : rien n'est enregistré avant « Importer ». Un import peut
          être rejoué pour corriger un résultat, sans créer de doublon.
        </AppText>

        <View
          style={[styles.section, { backgroundColor: theme.surface }]}
          testID="results-import-help"
        >
          <AppText
            variant="body"
            weight="600"
            style={styles.mb8}
            accessibilityRole="header"
          >
            Colonnes attendues
          </AppText>
          {RESULTS_CSV_COLUMNS.map((column) => (
            <AppText
              key={column.name}
              variant="caption"
              color={theme.textSecondary}
              style={styles.mb4}
            >
              {`• ${column.name}${column.required ? "" : " (facultatif)"} : ${column.description}`}
            </AppText>
          ))}
          <AppText variant="caption" color={theme.textSecondary}>
            Ligne d'en-tête obligatoire, séparateur « ; » ou « , ».
          </AppText>
        </View>

        <View style={styles.inputHeader}>
          <AppText
            variant="body"
            weight="600"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            Contenu du fichier
          </AppText>
          <AppButton
            title="Coller"
            variant="ghost"
            onPress={pasteFromClipboard}
            testID="results-import-paste"
            accessibilityLabel="Coller depuis le presse-papiers"
            accessibilityHint="Remplace le texte par le contenu copié"
          />
        </View>
        <TextInput
          testID="results-import-input"
          accessibilityLabel="Contenu CSV des résultats"
          accessibilityHint="Collez ici le classement au format CSV"
          style={[
            styles.input,
            {
              color: theme.text,
              backgroundColor: theme.inputBackground,
              borderColor: tooLarge ? theme.danger : theme.border,
            },
          ]}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical="top"
          placeholder={
            "epreuve;tour;classement;couple\nLatines Adultes Avancé;Finale;1;Martin / Durand"
          }
          placeholderTextColor={theme.textSecondary}
          value={csv}
          onChangeText={setCsv}
        />
        <AppText
          variant="caption"
          color={tooLarge ? theme.danger : theme.textSecondary}
          style={styles.mt4}
          testID="results-import-length"
        >
          {`${numberFormatter.format(csv.length)} / ${numberFormatter.format(MAX_RESULTS_CSV_LENGTH)} caractères`}
          {tooLarge
            ? " — trop long : découpez le fichier par épreuve et importez chaque partie séparément."
            : ""}
        </AppText>

        <View style={styles.actions}>
          <AppButton
            title="Vérifier"
            variant="outline"
            onPress={() => {
              check().catch(() => {});
            }}
            loading={busy === "checking"}
            disabled={!canCheck}
            testID="results-import-check"
            accessibilityHint="Contrôle le fichier sans rien enregistrer"
            style={styles.action}
          />
          <AppButton
            title="Importer"
            variant="primary"
            onPress={() => {
              confirmImport().catch(() => {});
            }}
            loading={busy === "importing"}
            disabled={!canImport}
            testID="results-import-submit"
            accessibilityHint={
              canImport
                ? "Enregistre les résultats vérifiés"
                : "Disponible après une vérification réussie du texte"
            }
            style={styles.action}
          />
        </View>

        {failure ? (
          <View
            style={[
              styles.section,
              styles.mt16,
              { backgroundColor: theme.surface, borderColor: theme.danger },
              styles.bordered,
            ]}
            testID="results-import-failure"
          >
            <AppText variant="body" weight="600" color={theme.danger}>
              {failure.message}
            </AppText>
            {failure.errors.map((lineError) => (
              <AppText
                key={`${lineError.line}-${lineError.message}`}
                variant="caption"
                style={styles.mt4}
              >
                {formatLineError(lineError)}
              </AppText>
            ))}
          </View>
        ) : null}

        {preview ? (
          <View
            style={[
              styles.section,
              styles.mt16,
              { backgroundColor: theme.surface },
            ]}
            testID="results-import-preview"
          >
            <AppText variant="body" weight="600" accessibilityRole="header">
              Aperçu
            </AppText>
            <AppText variant="body" style={styles.mt4}>
              {formatPreview(preview)}
            </AppText>
            <AppText
              variant="caption"
              color={theme.textSecondary}
              style={styles.mt4}
            >
              Touchez « Importer » pour enregistrer ces résultats.
            </AppText>
          </View>
        ) : null}

        {report ? (
          <View
            style={[
              styles.section,
              styles.mt16,
              { backgroundColor: theme.surface, borderColor: theme.success },
              styles.bordered,
            ]}
            testID="results-import-report"
          >
            <AppText
              variant="body"
              weight="600"
              color={theme.success}
              style={styles.mb8}
              accessibilityRole="header"
            >
              Import terminé
            </AppText>
            {reportRows(report).map((row) => (
              <View
                key={row.key}
                style={styles.reportRow}
                accessible
                accessibilityLabel={`${row.label} : ${row.value}`}
                accessibilityHint="Bilan de l'import"
                testID={`results-import-report-${row.key}`}
              >
                <AppText variant="body">{row.label}</AppText>
                <AppText variant="body" weight="600">
                  {numberFormatter.format(row.value)}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <PinnedHeader
        theme={theme}
        isDark={isDark}
        title="Importer les résultats"
        left={<BackButton onPress={() => navigation.goBack()} />}
        onHeightChange={setHeaderH}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20 },
  section: { borderRadius: 16, padding: 16 },
  bordered: { borderWidth: 1 },
  inputHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    minHeight: 180,
    maxHeight: 320,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 13,
  },
  actions: { flexDirection: "row", gap: 12, marginTop: 16 },
  action: { flex: 1 },
  reportRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  mb4: { marginBottom: 4 },
  mb8: { marginBottom: 8 },
  mb16: { marginBottom: 16 },
  mt4: { marginTop: 4 },
  mt16: { marginTop: 16 },
});
