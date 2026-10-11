/* eslint-disable react-native-a11y/has-accessibility-hint, react-native-a11y/has-valid-accessibility-descriptors -- TODO: add a11y to form fields */
import {
  Award,
  CreditCard,
  User,
  Users,
  UsersRound,
  X,
} from "lucide-react-native";
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";

import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../../navigation/types";
import { formatCompetitionLevels } from "../../../utils/competitionLevel";
import { formatDiscipline } from "../../../utils/discipline";
import { formatFfdValidUntil } from "../../license/utils/licenseSeason";

type Props = NativeStackScreenProps<RootStackParamList, "ClubMemberEditor">;

/** Affiche une valeur ou "—" si vide */
function fieldValue(value: string | null | undefined): string {
  return value?.trim() ?? "—";
}

/** Libellé couleur passport (ex. JAUNE → Jaune) */
function passportLabel(level: string | null | undefined): string {
  if (!level) return "—";
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
}

/** Statut actif/inactif dérivé de la date de validité de la licence (non modifiable). */
function deriveMemberStatus(
  validUntil: Date | string | null | undefined,
): "ACTIVE" | "INACTIVE" {
  if (!validUntil) return "INACTIVE";
  const end =
    typeof validUntil === "string" ? new Date(validUntil) : validUntil;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return end >= today ? "ACTIVE" : "INACTIVE";
}

export const ClubMemberEditorScreen: React.FC<Props> = ({
  navigation,
  route,
}) => {
  const { theme } = useTheme();

  const member = route.params?.member;
  const isEditing = !!member?.id;

  const [firstName, setFirstName] = useState(member?.firstName ?? "");
  const [lastName, setLastName] = useState(member?.lastName ?? "");

  const licenseNumber = member?.license?.number ?? null;
  const licenseValidUntil = member?.license?.validUntil;
  const category = member?.category ?? null;
  const ageGroup = member?.ageGroup ?? null;
  // Per-discipline level (« Latines : Avancé · Standards : Débutant »),
  // legacy single level as a fallback. Read-only: not editable from the app.
  const competitionLevels = formatCompetitionLevels(member);
  const passportLatin = member?.passportLevelLatin ?? null;
  const passportStandard = member?.passportLevelStandard ?? null;
  const partnerName = member?.partnerName ?? null;
  const wdsf = member?.wdsf ?? null;

  const statusLabel = deriveMemberStatus(licenseValidUntil);

  const handleSave = () => {
    if (!firstName || !lastName) {
      Alert.alert(
        "Erreur",
        "Veuillez remplir les champs obligatoires (Nom, Prénom).",
      );
      return;
    }

    Alert.alert(
      "Succès",
      `Membre ${isEditing ? "modifié" : "ajouté"} avec succès !`,
      [{ text: "OK", onPress: () => navigation.goBack() }],
    );
  };

  const content = (
    <>
      {/* Avatar / Statut (lecture seule, dérivé de la validité de la licence) */}
      <View style={styles.avatarBlock}>
        <View
          style={[styles.avatarPlaceholder, { backgroundColor: theme.primary }]}
        >
          <AppText variant="h1" style={styles.colorWhite}>
            {firstName && lastName ? `${firstName[0]}${lastName[0]}` : "+"}
          </AppText>
        </View>
        <View
          style={[
            styles.statusBadge,
            statusLabel === "ACTIVE"
              ? { backgroundColor: theme.primary }
              : { backgroundColor: theme.textSecondary },
          ]}
        >
          <AppText variant="caption" style={styles.colorWhite}>
            Statut : {statusLabel === "ACTIVE" ? "Actif" : "Inactif"}
          </AppText>
        </View>
        <AppText
          variant="caption"
          style={[styles.statusHint, { color: theme.textSecondary }]}
        >
          Géré par la date de validité de la licence
        </AppText>
        {member?.id && (
          <TouchableOpacity
            style={[styles.careerButton, { borderColor: theme.border }]}
            onPress={() =>
              navigation.navigate("ViewCareer", {
                userId: member.id,
                userName: `${member.firstName} ${member.lastName}`.trim(),
              })
            }
          >
            <Award size={20} color={theme.primary} />
            <AppText
              variant="button"
              style={[styles.colorPrimaryML8, { color: theme.primary }]}
            >
              Voir la carrière
            </AppText>
          </TouchableOpacity>
        )}
      </View>

      {/* Identité */}
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <AppText
          variant="caption"
          style={[styles.sectionLabel, { color: theme.textSecondary }]}
        >
          Identité
        </AppText>
        <View style={styles.inputGroup}>
          <AppText
            variant="caption"
            style={[styles.mb6, { color: theme.textSecondary }]}
          >
            Prénom
          </AppText>
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
          >
            <User
              size={20}
              color={theme.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              accessibilityLabel="Prénom"
              style={[styles.input, { color: theme.text }]}
              placeholder="Ex: Jean"
              placeholderTextColor={theme.textSecondary}
              value={firstName}
              onChangeText={setFirstName}
            />
          </View>
        </View>
        <View style={styles.inputGroup}>
          <AppText
            variant="caption"
            style={[styles.mb6, { color: theme.textSecondary }]}
          >
            Nom
          </AppText>
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
          >
            <User
              size={20}
              color={theme.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              accessibilityLabel="Nom"
              style={[styles.input, { color: theme.text }]}
              placeholder="Ex: Dupont"
              placeholderTextColor={theme.textSecondary}
              value={lastName}
              onChangeText={setLastName}
            />
          </View>
        </View>
      </View>

      {/* Licence FFD */}
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <AppText
          variant="caption"
          style={[styles.sectionLabel, { color: theme.textSecondary }]}
        >
          Licence FFD
        </AppText>
        <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
          <CreditCard
            size={20}
            color={theme.textSecondary}
            style={styles.inputIcon}
          />
          <View style={styles.readOnlyContent}>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Numéro de licence
            </AppText>
            <AppText variant="body" style={{ color: theme.text }}>
              {isEditing
                ? fieldValue(licenseNumber ?? null)
                : "Renseigné après vérification licence"}
            </AppText>
          </View>
        </View>
        <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
          <View style={styles.readOnlyContent}>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Valide jusqu'à
            </AppText>
            <AppText variant="body" style={{ color: theme.text }}>
              {formatFfdValidUntil(licenseValidUntil) || "—"}
            </AppText>
          </View>
        </View>
        <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
          <View style={styles.readOnlyContent}>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Classe d'âge
            </AppText>
            <AppText variant="body" style={{ color: theme.text }}>
              {fieldValue(ageGroup)}
            </AppText>
          </View>
        </View>
        <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
          <View style={styles.readOnlyContent}>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Catégorie de danse
            </AppText>
            <AppText variant="body" style={{ color: theme.text }}>
              {fieldValue(category ? formatDiscipline(category) : null)}
            </AppText>
          </View>
        </View>
        <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
          <View style={styles.readOnlyContent}>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Niveau de compétition
            </AppText>
            <AppText variant="body" style={{ color: theme.text }}>
              {fieldValue(competitionLevels)}
            </AppText>
          </View>
        </View>
        <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
          <View style={styles.readOnlyContent}>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Couleur du passeport (Latines)
            </AppText>
            <AppText variant="body" style={{ color: theme.text }}>
              {passportLabel(passportLatin)}
            </AppText>
          </View>
        </View>
        <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
          <View style={styles.readOnlyContent}>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Couleur du passeport (Standard)
            </AppText>
            <AppText variant="body" style={{ color: theme.text }}>
              {passportLabel(passportStandard)}
            </AppText>
          </View>
        </View>
      </View>

      {/* Licence WDSF (affiché uniquement si le membre a lié sa licence WDSF) */}
      {wdsf && (
        <View style={[styles.section, { backgroundColor: theme.surface }]}>
          <AppText
            variant="caption"
            style={[styles.sectionLabel, { color: theme.textSecondary }]}
          >
            Licence WDSF
          </AppText>
          <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
            <View style={styles.readOnlyContent}>
              <AppText variant="caption" style={{ color: theme.textSecondary }}>
                MIN (numéro de licence WDSF)
              </AppText>
              <AppText variant="body" style={{ color: theme.text }}>
                {fieldValue(wdsf.min)}
              </AppText>
            </View>
          </View>
          <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
            <View style={styles.readOnlyContent}>
              <AppText variant="caption" style={{ color: theme.textSecondary }}>
                Nationality
              </AppText>
              <AppText variant="body" style={{ color: theme.text }}>
                {fieldValue(wdsf.nationality)}
              </AppText>
            </View>
          </View>
          <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
            <View style={styles.readOnlyContent}>
              <AppText variant="caption" style={{ color: theme.textSecondary }}>
                Licence Type
              </AppText>
              <AppText variant="body" style={{ color: theme.text }}>
                {fieldValue(wdsf.licenseType)}
              </AppText>
            </View>
          </View>
          <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
            <View style={styles.readOnlyContent}>
              <AppText variant="caption" style={{ color: theme.textSecondary }}>
                Age group
              </AppText>
              <AppText variant="body" style={{ color: theme.text }}>
                {fieldValue(wdsf.ageGroup)}
              </AppText>
            </View>
          </View>
          <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
            <View style={styles.readOnlyContent}>
              <AppText variant="caption" style={{ color: theme.textSecondary }}>
                License expires on
              </AppText>
              <AppText variant="body" style={{ color: theme.text }}>
                {wdsf.expiresOn
                  ? new Date(wdsf.expiresOn).toLocaleDateString("fr-FR")
                  : "—"}
              </AppText>
            </View>
          </View>
        </View>
      )}

      {/* Partenaire / Équipe */}
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <AppText
          variant="caption"
          style={[styles.sectionLabel, { color: theme.textSecondary }]}
        >
          Partenaire & équipes
        </AppText>
        {partnerName ? (
          <View style={[styles.readOnlyRow, { borderColor: theme.border }]}>
            <View style={styles.readOnlyContent}>
              <AppText variant="caption" style={{ color: theme.textSecondary }}>
                Partenaire (fréquent)
              </AppText>
              <AppText variant="body" style={{ color: theme.text }}>
                {partnerName}
              </AppText>
            </View>
          </View>
        ) : (
          <AppText
            variant="body"
            style={[styles.padV8, { color: theme.textSecondary }]}
          >
            Aucun partenaire enregistré pour les inscriptions.
          </AppText>
        )}
        <View style={styles.linkRow}>
          <TouchableOpacity
            style={[styles.linkButton, { borderColor: theme.border }]}
            onPress={() => navigation.navigate("ClubCouples")}
          >
            <Users size={18} color={theme.primary} />
            <AppText variant="button" style={{ color: theme.primary }}>
              Gérer les couples
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkButton, { borderColor: theme.border }]}
            onPress={() => navigation.navigate("ClubSoloTeams")}
          >
            <UsersRound size={18} color={theme.primary} />
            <AppText variant="button" style={{ color: theme.primary }}>
              Voir les Solo Teams
            </AppText>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footerSpacer} />
    </>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["bottom"]}
    >
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
          style={styles.closeButton}
        >
          <X size={24} color={theme.text} />
        </TouchableOpacity>
        <AppText variant="h3" style={{ color: theme.text }}>
          {isEditing ? "Fiche membre" : "Nouveau membre"}
        </AppText>
        <View style={styles.w40} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { borderTopColor: theme.border, backgroundColor: theme.surface },
          ]}
        >
          <AppButton
            title={isEditing ? "Enregistrer" : "Ajouter le membre"}
            onPress={handleSave}
            variant="primary"
            style={styles.fullWidth}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  closeButton: { padding: 8 },
  keyboardView: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 24 },
  avatarBlock: { alignItems: "center", marginBottom: 24 },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  statusBadge: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignSelf: "center",
  },
  statusHint: {
    marginTop: 6,
    fontSize: 12,
  },
  careerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  section: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  sectionLabel: {
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  inputGroup: { marginBottom: 16 },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 50,
  },
  inputIcon: { marginRight: 12 },
  input: {
    flex: 1,
    fontSize: 16,
    height: "100%",
  },
  readOnlyRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  readOnlyContent: { flex: 1 },
  linkRow: { gap: 10, marginTop: 8 },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  footerSpacer: { height: 20 },
  footer: {
    padding: 20,
    borderTopWidth: 1,
  },
  colorWhite: { color: "#fff" },
  colorPrimaryML8: { marginLeft: 8 },
  mb6: { marginBottom: 6 },
  padV8: { paddingVertical: 8 },
  w40: { width: 40 },
  fullWidth: { width: "100%" as const },
});
