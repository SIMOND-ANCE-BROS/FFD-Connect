import DateTimePicker from "@react-native-community/datetimepicker";
import { AlignLeft, Calendar } from "lucide-react-native";
import React from "react";
import {
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import { AppText } from "../../../../components/AppText";
import { FluidSegmentedTab } from "../../../../components/FluidSegmentedTab";
import { EXPO_PUBLIC_GOOGLE_API_KEY } from "../../../../config";
import { AppTheme } from "../../../../context/ThemeContext";
import {
  COMPETITION_TYPE_LABELS,
  MAJOR_SUB_TYPE_LABELS,
  MAJOR_SUB_TYPES,
  type CompetitionStatus,
  type CompetitionType,
  type MajorSubType,
  toCompetitionStatus,
} from "../../hooks/useClubCompetitionEditorLogic";
import { styles } from "./competition-editor.styles";

const GOOGLE_PLACES_API_KEY: string = EXPO_PUBLIC_GOOGLE_API_KEY;

interface Props {
  theme: AppTheme;
  /** "COMPETITION" (défaut) ou "EVENT" (événement non compétitif). */
  isEvent: boolean;
  status: string;
  setStatus: (s: CompetitionStatus) => void;
  competitionType: CompetitionType;
  setCompetitionType: (t: CompetitionType) => void;
  majorSubType: MajorSubType | null;
  setMajorSubType: (t: MajorSubType) => void;
  title: string;
  setTitle: (t: string) => void;
  date: Date;
  showDatePicker: boolean;
  setShowDatePicker: (v: boolean) => void;
  dateText: string;
  onDateChange: (_event: unknown, date?: Date) => void;
  location: string;
  setLocation: (l: string) => void;
  eventsDescription: string;
  setEventsDescription: (v: string) => void;
}

export const CompetitionGeneralTab: React.FC<Props> = ({
  theme,
  isEvent,
  status,
  setStatus,
  competitionType,
  setCompetitionType,
  majorSubType,
  setMajorSubType,
  title,
  setTitle,
  date,
  showDatePicker,
  setShowDatePicker,
  dateText,
  onDateChange,
  location,
  setLocation,
  eventsDescription,
  setEventsDescription,
}) => (
  <ScrollView style={styles.scrollContent}>
    <View style={[styles.section, { backgroundColor: theme.surface }]}>
      <AppText
        variant="caption"
        style={[styles.sectionLabel, { color: theme.textSecondary }]}
      >
        Statut
      </AppText>
      <FluidSegmentedTab
        activeValue={status}
        testID="competition-editor-status-tabs"
        onChange={(val: string) => setStatus(toCompetitionStatus(val))}
        options={[
          { label: "Brouillon", value: "DRAFT" },
          { label: "Ouverte", value: "OPEN" },
          { label: "Terminée", value: "CLOSED" },
        ]}
      />
    </View>

    {!isEvent && (
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <AppText
          variant="caption"
          style={[styles.sectionLabel, { color: theme.textSecondary }]}
        >
          Type de compétition
        </AppText>
        <FluidSegmentedTab
          activeValue={competitionType}
          testID="competition-editor-type-tabs"
          onChange={(val: string) => setCompetitionType(val as CompetitionType)}
          options={(
            ["PROXIMITE", "NATIONALE", "MAJEURE", "INTERNATIONALE"] as const
          ).map((t) => ({ label: COMPETITION_TYPE_LABELS[t], value: t }))}
        />
      </View>
    )}

    {!isEvent && competitionType === "MAJEURE" && (
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <AppText
          variant="caption"
          style={[styles.sectionLabel, { color: theme.textSecondary }]}
        >
          Type de compétition majeure
        </AppText>
        <View style={styles.chipRow}>
          {MAJOR_SUB_TYPES.map((subType: MajorSubType) => {
            const isSelected = majorSubType === subType;
            const chipTextColor = { color: isSelected ? "#FFF" : theme.text };
            return (
              <TouchableOpacity
                key={subType}
                accessibilityRole="button"
                onPress={() => setMajorSubType(subType)}
                style={[
                  styles.chip,
                  styles.chipRadius8,
                  isSelected
                    ? {
                        backgroundColor: theme.primary,
                        borderColor: theme.primary,
                      }
                    : { borderColor: theme.border },
                ]}
              >
                <AppText
                  variant="caption"
                  style={chipTextColor}
                  numberOfLines={2}
                >
                  {MAJOR_SUB_TYPE_LABELS[subType]}
                </AppText>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    )}

    <View style={[styles.section, { backgroundColor: theme.surface }]}>
      <AppText
        variant="caption"
        style={[styles.sectionLabelLg, { color: theme.textSecondary }]}
      >
        Informations Générales
      </AppText>

      <View style={styles.inputGroup}>
        <AppText variant="body" style={[styles.mb8, { color: theme.text }]}>
          Nom de l'événement
        </AppText>
        <View
          style={[
            styles.inputContainer,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <AlignLeft
            size={20}
            color={theme.textSecondary}
            style={styles.inputIcon}
          />
          <TextInput
            accessibilityLabel="Text input field"
            accessibilityHint="Saisissez le nom de l'événement"
            testID="competition-editor-title-input"
            style={[styles.input, { color: theme.text }]}
            placeholder="Ex: Grand Prix de Paris"
            placeholderTextColor={theme.textSecondary}
            value={title}
            onChangeText={setTitle}
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <AppText variant="body" style={[styles.mb8, { color: theme.text }]}>
          Date
        </AppText>
        <TouchableOpacity
          accessibilityRole="button"
          testID="competition-editor-date-button"
          onPress={() => setShowDatePicker(true)}
          style={[
            styles.inputContainer,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <Calendar
            size={20}
            color={theme.textSecondary}
            style={styles.inputIcon}
          />
          <AppText
            variant="body"
            style={{ color: dateText ? theme.text : theme.textSecondary }}
          >
            {dateText || "Sélectionner une date"}
          </AppText>
        </TouchableOpacity>
        {showDatePicker && (
          <DateTimePicker
            value={date}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={onDateChange}
          />
        )}
      </View>

      <View style={[styles.inputGroup, styles.mb0ZIndex1000]}>
        <AppText variant="body" style={[styles.mb8, { color: theme.text }]}>
          Lieu
        </AppText>
        <View style={styles.height200}>
          <GooglePlacesAutocomplete
            placeholder="Rechercher une adresse..."
            onPress={(data, _details = null) => {
              setLocation(data.description);
            }}
            query={{
              key: GOOGLE_PLACES_API_KEY,
              language: "fr",
            }}
            textInputProps={{
              value: location,
              onChangeText: setLocation,
              placeholderTextColor: theme.textSecondary,
              style: {
                color: theme.text,
                backgroundColor: theme.background,
                borderRadius: 12,
                paddingHorizontal: 12,
                height: 50,
                borderWidth: 1,
                borderColor: theme.border,
                flex: 1,
              },
            }}
            styles={{
              container: { flex: 0 },
              textInputContainer: {
                backgroundColor: "transparent",
                borderTopWidth: 0,
                borderBottomWidth: 0,
              },
              listView: {
                backgroundColor: theme.surface,
                borderRadius: 8,
                marginTop: 4,
                borderWidth: 1,
                borderColor: theme.border,
              },
              description: { color: theme.text },
              row: { backgroundColor: theme.surface },
            }}
            enablePoweredByContainer={false}
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <AppText variant="body" style={[styles.mb8, { color: theme.text }]}>
          {isEvent ? "Programme" : "Programme des épreuves"}
        </AppText>
        <View
          style={[
            styles.inputContainer,
            styles.textAreaContainer,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <AlignLeft
            size={20}
            color={theme.textSecondary}
            style={styles.inputIcon}
          />
          <TextInput
            accessibilityLabel="Programme"
            accessibilityHint="Décrivez le programme (texte libre)"
            testID="competition-editor-programme-input"
            style={[styles.input, styles.textArea, { color: theme.text }]}
            placeholder={
              isEvent
                ? "Ex: 19h accueil, 20h gala, 22h soirée dansante..."
                : "Programme des épreuves (texte libre)"
            }
            placeholderTextColor={theme.textSecondary}
            value={eventsDescription}
            onChangeText={setEventsDescription}
            multiline
          />
        </View>
      </View>
    </View>
  </ScrollView>
);
