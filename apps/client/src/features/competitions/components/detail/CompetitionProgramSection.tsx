import { FileText, LinkIcon } from "lucide-react-native";
import React from "react";
import { Linking, StyleSheet, TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { useTheme } from "../../../../context/ThemeContext";

interface ProgramInfo {
  type?: string;
  eventsDescription?: string;
  programUrl?: string;
  registrationUrl?: string;
  circularUrl?: string;
}

/** Convertit le HTML léger de FFD (danceEventDescription) en texte lisible. */
function htmlToText(html?: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Affiche le programme réel fourni par la FFD (type d'épreuves + description
 * libre + PDF/lien d'inscription). Remplace les anciennes "épreuves"
 * placeholder : la FFD n'expose pas d'épreuves structurées.
 */
export const CompetitionProgramSection = ({
  type,
  eventsDescription,
  programUrl,
  registrationUrl,
  circularUrl,
}: ProgramInfo): React.JSX.Element => {
  const { theme } = useTheme();
  const programme = htmlToText(eventsDescription);

  const open = (url?: string) => {
    if (url) void Linking.openURL(url);
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <AppText variant="h3" weight="bold" style={styles.heading}>
        Programme des épreuves
      </AppText>

      {type ? (
        <View style={[styles.badge, { backgroundColor: `${theme.primary}1A` }]}>
          <AppText
            variant="caption"
            weight="600"
            style={{ color: theme.primary }}
          >
            {type}
          </AppText>
        </View>
      ) : null}

      {programme ? (
        <AppText
          variant="body"
          style={[styles.description, { color: theme.textSecondary }]}
        >
          {programme}
        </AppText>
      ) : !type ? (
        <AppText
          variant="body"
          style={[styles.description, { color: theme.textSecondary }]}
        >
          Le programme détaillé sera communiqué par l'organisateur.
        </AppText>
      ) : null}

      {programUrl ? (
        <TouchableOpacity
          style={[styles.link, { borderColor: theme.primary }]}
          onPress={() => open(programUrl)}
          accessibilityRole="button"
          accessibilityLabel="Ouvrir le programme (PDF)"
          accessibilityHint="Ouvre le PDF du programme des épreuves"
        >
          <FileText size={18} color={theme.primary} />
          <AppText weight="600" style={{ color: theme.primary }}>
            Programme (PDF)
          </AppText>
        </TouchableOpacity>
      ) : null}

      {registrationUrl ? (
        <TouchableOpacity
          style={[styles.link, { borderColor: theme.primary }]}
          onPress={() => open(registrationUrl)}
          accessibilityRole="button"
          accessibilityLabel="Ouvrir la page d'inscription"
          accessibilityHint="Ouvre la page d'inscription ou d'informations"
        >
          <LinkIcon size={18} color={theme.primary} />
          <AppText weight="600" style={{ color: theme.primary }}>
            Inscription / infos
          </AppText>
        </TouchableOpacity>
      ) : null}

      {circularUrl ? (
        <TouchableOpacity
          style={[styles.link, { borderColor: theme.primary }]}
          onPress={() => open(circularUrl)}
          accessibilityRole="button"
          accessibilityLabel="Ouvrir la circulaire"
          accessibilityHint="Ouvre la circulaire de la compétition"
        >
          <FileText size={18} color={theme.primary} />
          <AppText weight="600" style={{ color: theme.primary }}>
            Circulaire
          </AppText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 10,
  },
  heading: { marginBottom: 2 },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  description: { lineHeight: 21 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
});
