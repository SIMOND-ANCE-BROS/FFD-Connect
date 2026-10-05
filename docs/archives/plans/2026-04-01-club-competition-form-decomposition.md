# ClubCompetitionFormScreen Decomposition Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `ClubCompetitionFormScreen.tsx` (1839 lines) into 4 focused tab components + 1 shared styles file, leaving the screen as a ~150-line orchestrator.

**Architecture:** Extract each tab's render function and its associated modal(s) into a dedicated component. Move all styles to a shared `competition-editor.styles.ts`. The screen component only handles: hook invocation, header, tab switcher, footer, and rendering the active tab.

**Tech Stack:** React Native, TypeScript, `useClubCompetitionEditorLogic` hook

**Worktree:** Work exclusively in `/Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/` on branch `feature/club-competition-form-decomposition`.

---

### Task 1: Extract shared styles

**Files:**

- Create: `apps/client/src/features/club/components/editor/competition-editor.styles.ts`
- Modify: `apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx`

All styles currently live in the single `StyleSheet.create({})` at the bottom of the screen file. Extract them to a shared file so all tab components can import them.

- [ ] **Step 1: Create the shared styles file**

```typescript
// apps/client/src/features/club/components/editor/competition-editor.styles.ts
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  closeButton: { padding: 8 },
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  scrollContent: { paddingVertical: 16 },
  inputGroup: { marginBottom: 16 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 54,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16 },
  footer: { padding: 16, borderTopWidth: 1 },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    marginHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deleteButton: { padding: 8, backgroundColor: '#ffeff0', borderRadius: 8 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: 400,
  },
  rowInput: { flexDirection: 'row', justifyContent: 'space-between' },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  sectionHeader: { paddingHorizontal: 16 },
  iconButton: { padding: 8, marginLeft: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center' },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
  },
  ticketingInput: { borderWidth: 1, borderRadius: 8, padding: 8, fontSize: 16 },
  layoutTypeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  layoutSection: { marginTop: 16 },
  layoutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  organisationDescription: { marginBottom: 16 },
  modalTitle: { marginBottom: 16 },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  modalAction: { flex: 1 },
  organisationDesc: { marginBottom: 16, paddingHorizontal: 20 },
  sectionLabel: { marginBottom: 12, textTransform: 'uppercase' as const },
  sectionLabelLg: { marginBottom: 16, textTransform: 'uppercase' as const },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRadius8: { borderRadius: 8 },
  padding8: { padding: 8 },
  timeAlignCol: { alignItems: 'center', width: 60 },
  flex1PadH12: { flex: 1, paddingHorizontal: 12 },
  dirRow: { flexDirection: 'row' },
  flex1: { flex: 1 },
  mb16: { marginBottom: 16 },
  mb8: { marginBottom: 8 },
  fullWidth: { width: '100%' as const },
  maxH80pct: { maxHeight: '80%' as const },
  borderBox: { borderWidth: 1, borderRadius: 8, padding: 8 },
  actionBtns: { flexDirection: 'row', gap: 10, marginTop: 20 },
  flex1MR8: { flex: 1, marginRight: 8 },
  w100: { width: 100 },
  textCenter: { textAlign: 'center' as const },
  mt6: { marginTop: 6 },
  tagRowMT8: { flexDirection: 'row', gap: 8, marginTop: 8 },
  mt16: { marginTop: 16 },
  flex1ML12: { flex: 1, marginLeft: 12 },
  mb12: { marginBottom: 12 },
  w40: { width: 40 },
  padding16: { padding: 16 },
  flex2: { flex: 2 },
  minH400: { minHeight: 400 },
  rowBetweenMB16: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  mb24: { marginBottom: 24 },
  mt24: { marginTop: 24 },
  negMt8Mb8: { marginTop: -8, marginBottom: 8 },
  ml8: { marginLeft: 8 },
  mb16PadH20: { marginBottom: 16, paddingHorizontal: 20 },
  dashedBorder: { borderStyle: 'dashed' as const },
  dashedBorderMT12: { borderStyle: 'dashed' as const, marginTop: 12 },
  height200: { height: 200 },
  mb0ZIndex1000: { marginBottom: 0, zIndex: 1000 },
  qrContainer: {
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 16,
    alignSelf: 'center',
  },
  fontSize10Bold: { fontSize: 10, fontWeight: 'bold' as const },
  fontSize10Semi: { fontSize: 10, fontWeight: '600' as const },
  tagChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  eventHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
    gap: 6,
  },
  ml8w600: { marginLeft: 8, fontWeight: '600' as const },
  organisationContainer: { paddingHorizontal: 20, paddingBottom: 100 },
});
```

- [ ] **Step 2: Update ClubCompetitionFormScreen to import from shared styles**

Replace the `const styles = StyleSheet.create({...})` block at the bottom of `ClubCompetitionFormScreen.tsx` with a single import:

```typescript
import { styles } from '../components/editor/competition-editor.styles';
```

Remove the `StyleSheet` import from React Native (only if it's no longer used).

- [ ] **Step 3: Verify app builds**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/apps/client
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errors (or same errors as before).

- [ ] **Step 4: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition
git add apps/client/src/features/club/components/editor/competition-editor.styles.ts
git add apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx
git commit -m "refactor(club): extract competition editor shared styles"
```

---

### Task 2: Create CompetitionGeneralTab

**Files:**

- Create: `apps/client/src/features/club/components/editor/CompetitionGeneralTab.tsx`
- Modify: `apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx`

Extract `renderGeneral()` body into a standalone component. No modal in this tab.

- [ ] **Step 1: Create CompetitionGeneralTab.tsx**

```typescript
// apps/client/src/features/club/components/editor/CompetitionGeneralTab.tsx
import DateTimePicker from "@react-native-community/datetimepicker";
import { AlignLeft, Calendar } from "lucide-react-native";
import React from "react";
import { Platform, ScrollView, TextInput, TouchableOpacity, View } from "react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import { AppText } from "../../../../components/AppText";
import { FluidSegmentedTab } from "../../../../components/FluidSegmentedTab";
import { EXPO_PUBLIC_GOOGLE_API_KEY } from "../../../../config";
import {
  COMPETITION_TYPE_LABELS,
  MAJOR_SUB_TYPE_LABELS,
  MAJOR_SUB_TYPES,
  type CompetitionType,
  type MajorSubType,
  toCompetitionStatus,
} from "../../hooks/useClubCompetitionEditorLogic";
import { styles } from "./competition-editor.styles";

const GOOGLE_PLACES_API_KEY: string = EXPO_PUBLIC_GOOGLE_API_KEY;

interface Props {
  theme: ReturnType<typeof import("../../../../context/ThemeContext").useTheme>["theme"];
  status: string;
  setStatus: (s: ReturnType<typeof toCompetitionStatus>) => void;
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
  onDateChange: (event: unknown, date?: Date) => void;
  location: string;
  setLocation: (l: string) => void;
}

export const CompetitionGeneralTab: React.FC<Props> = ({
  theme,
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
}) => (
  <ScrollView style={styles.scrollContent}>
    <View style={[styles.section, { backgroundColor: theme.surface }]}>
      <AppText variant="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
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

    <View style={[styles.section, { backgroundColor: theme.surface }]}>
      <AppText variant="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
        Type de compétition
      </AppText>
      <FluidSegmentedTab
        activeValue={competitionType}
        testID="competition-editor-type-tabs"
        onChange={(val: string) => setCompetitionType(val as CompetitionType)}
        options={(["PROXIMITE", "NATIONALE", "MAJEURE", "INTERNATIONALE"] as const).map((t) => ({
          label: COMPETITION_TYPE_LABELS[t],
          value: t,
        }))}
      />
    </View>

    {competitionType === "MAJEURE" && (
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <AppText variant="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
          Type de compétition majeure
        </AppText>
        <View style={styles.chipRow}>
          {MAJOR_SUB_TYPES.map((subType: MajorSubType) => {
            const isSelected = majorSubType === subType;
            return (
              <TouchableOpacity
                key={subType}
                accessibilityRole="button"
                onPress={() => setMajorSubType(subType)}
                style={[
                  styles.chip,
                  styles.chipRadius8,
                  isSelected
                    ? { backgroundColor: theme.primary, borderColor: theme.primary }
                    : { borderColor: theme.border },
                ]}
              >
                <AppText
                  variant="caption"
                  style={{ color: isSelected ? "#FFF" : theme.text }}
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
      <AppText variant="caption" style={[styles.sectionLabelLg, { color: theme.textSecondary }]}>
        Informations Générales
      </AppText>

      <View style={styles.inputGroup}>
        <AppText variant="body" style={[styles.mb8, { color: theme.text }]}>
          Nom de l'événement
        </AppText>
        <View style={[styles.inputContainer, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <AlignLeft size={20} color={theme.textSecondary} style={styles.inputIcon} />
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
          style={[styles.inputContainer, { backgroundColor: theme.background, borderColor: theme.border }]}
        >
          <Calendar size={20} color={theme.textSecondary} style={styles.inputIcon} />
          <AppText variant="body" style={{ color: dateText ? theme.text : theme.textSecondary }}>
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
            query={{ key: GOOGLE_PLACES_API_KEY, language: "fr" }}
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
              textInputContainer: { backgroundColor: "transparent", borderTopWidth: 0, borderBottomWidth: 0 },
              listView: { backgroundColor: theme.surface, borderRadius: 8, marginTop: 4, borderWidth: 1, borderColor: theme.border },
              description: { color: theme.text },
              row: { backgroundColor: theme.surface },
            }}
            enablePoweredByContainer={false}
          />
        </View>
      </View>
    </View>
  </ScrollView>
);
```

- [ ] **Step 2: Replace renderGeneral in ClubCompetitionFormScreen**

Import the component:

```typescript
import { CompetitionGeneralTab } from '../components/editor/CompetitionGeneralTab';
```

Replace the `renderGeneral` function definition and its call `{activeTab === "GENERAL" && renderGeneral()}` with:

```typescript
{activeTab === "GENERAL" && (
  <CompetitionGeneralTab
    theme={theme}
    status={status}
    setStatus={setStatus}
    competitionType={competitionType}
    setCompetitionType={setCompetitionType}
    majorSubType={majorSubType}
    setMajorSubType={setMajorSubType}
    title={title}
    setTitle={setTitle}
    date={date}
    showDatePicker={showDatePicker}
    setShowDatePicker={setShowDatePicker}
    dateText={dateText}
    onDateChange={onDateChange}
    location={location}
    setLocation={setLocation}
  />
)}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/apps/client
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition
git add apps/client/src/features/club/components/editor/CompetitionGeneralTab.tsx
git add apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx
git commit -m "refactor(club): extract CompetitionGeneralTab component"
```

---

### Task 3: Create CompetitionEventsTab

**Files:**

- Create: `apps/client/src/features/club/components/editor/CompetitionEventsTab.tsx`
- Modify: `apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx`

Extract `renderEvents()` body AND the Add Event Modal (lines 792–1116) into one component.

- [ ] **Step 1: Create CompetitionEventsTab.tsx**

```typescript
// apps/client/src/features/club/components/editor/CompetitionEventsTab.tsx
import { Plus, Trash2 } from "lucide-react-native";
import React from "react";
import { Modal, ScrollView, TouchableOpacity, View } from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import { FluidSegmentedTab } from "../../../../components/FluidSegmentedTab";
import {
  COMPETITION_LEVELS,
  EVENT_KIND_LABELS,
  type CompetitionEvent,
  type CompetitionType,
  type EventKind,
} from "../../hooks/useClubCompetitionEditorLogic";
import { styles } from "./competition-editor.styles";

interface Props {
  theme: ReturnType<typeof import("../../../../context/ThemeContext").useTheme>["theme"];
  competitionType: CompetitionType;
  events: CompetitionEvent[];
  removeEvent: (id: string) => void;
  showEventModal: boolean;
  setShowEventModal: (v: boolean) => void;
  newEventKind: EventKind;
  setNewEventKind: (k: EventKind) => void;
  newEventType: "Couple" | "Solo";
  setNewEventType: (t: "Couple" | "Solo") => void;
  newEventCategory: string;
  setNewEventCategory: (c: string) => void;
  newEventAge: string;
  setNewEventAge: (a: string) => void;
  newEventLevel: string;
  setNewEventLevel: (l: string) => void;
  newEventAgeGroups: string[];
  toggleOpenAgeGroup: (g: string) => void;
  newEventOpenLevels: string[];
  toggleOpenLevel: (l: string) => void;
  allowedEventKindsForCurrentCompetition: EventKind[];
  levelOptionsForNewEvent: string[];
  ageOptionsForNewEvent: string[];
  addEvent: () => void;
}

export const CompetitionEventsTab: React.FC<Props> = ({
  theme,
  competitionType,
  events,
  removeEvent,
  showEventModal,
  setShowEventModal,
  newEventKind,
  setNewEventKind,
  newEventType,
  setNewEventType,
  newEventCategory,
  setNewEventCategory,
  newEventAge,
  setNewEventAge,
  newEventLevel,
  setNewEventLevel,
  newEventAgeGroups,
  toggleOpenAgeGroup,
  newEventOpenLevels,
  toggleOpenLevel,
  allowedEventKindsForCurrentCompetition,
  levelOptionsForNewEvent,
  ageOptionsForNewEvent,
  addEvent,
}) => (
  <>
    <ScrollView style={styles.scrollContent}>
      <View style={[styles.sectionHeader, styles.mb16]}>
        <AppText variant="body" style={{ color: theme.textSecondary }}>
          Définissez les catégories ouvertes à l'inscription.
        </AppText>
      </View>

      {events.map((event) => (
        <View key={event.id} style={[styles.card, { backgroundColor: theme.surface }]}>
          <View>
            <View style={styles.eventHeaderRow}>
              {event.type === "Solo" && event.kind !== "SOLO_TEAM" && (
                <View style={[styles.tagChip, { backgroundColor: `${theme.primary}20` }]}>
                  <AppText variant="caption" style={[styles.fontSize10Bold, { color: theme.primary }]}>
                    SOLO
                  </AppText>
                </View>
              )}
              {event.kind && (
                <View style={[styles.tagChip, { backgroundColor: `${theme.textSecondary}18` }]}>
                  <AppText variant="caption" style={[styles.fontSize10Semi, { color: theme.textSecondary }]}>
                    {EVENT_KIND_LABELS[event.kind]}
                  </AppText>
                </View>
              )}
              {event.kind !== "SOLO_TEAM" && (
                <AppText variant="body" weight="600" style={{ color: theme.text }}>
                  {event.category}
                </AppText>
              )}
            </View>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              {event.ageGroups?.length ? event.ageGroups.join(", ") : event.ageGroup}
              {event.kind === "CLASSIFICATRICE" && event.level
                ? ` · ${event.level}`
                : event.kind === "SOLO_TEAM" && event.level
                  ? ` · ${event.level}`
                  : event.kind === "OPEN" && event.openLevels?.length
                    ? ` · Niveaux: ${event.openLevels.join(", ")}`
                    : event.kind === "OPEN"
                      ? " · Tous niveaux"
                      : ""}
            </AppText>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            testID={`event-delete-${event.id}`}
            onPress={() => removeEvent(event.id)}
            style={styles.deleteButton}
          >
            <Trash2 size={20} color={theme.danger} />
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        accessibilityRole="button"
        testID="competition-editor-add-event-button"
        style={[styles.addButton, styles.dashedBorder, { borderColor: theme.primary }]}
        onPress={() => setShowEventModal(true)}
      >
        <Plus size={24} color={theme.primary} />
        <AppText variant="button" style={[styles.ml8, { color: theme.primary }]}>
          Ajouter une épreuve
        </AppText>
      </TouchableOpacity>
    </ScrollView>

    <Modal visible={showEventModal} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.surface }, styles.maxH80pct]}>
          <AppText variant="h3" style={[styles.mb16, { color: theme.text }]}>
            Ajouter une épreuve
          </AppText>

          <ScrollView>
            <View style={styles.inputGroup}>
              <AppText variant="caption" color={theme.textSecondary} style={styles.mb8}>
                Type d'épreuve
              </AppText>
              <View style={styles.chipRow}>
                {allowedEventKindsForCurrentCompetition.map((kind: EventKind) => {
                  const isSelected = newEventKind === kind;
                  return (
                    <TouchableOpacity
                      key={kind}
                      accessibilityRole="button"
                      onPress={() => setNewEventKind(kind)}
                      style={[
                        styles.chip,
                        styles.chipRadius8,
                        isSelected
                          ? { backgroundColor: theme.primary, borderColor: theme.primary }
                          : { borderColor: theme.border },
                      ]}
                    >
                      <AppText variant="caption" style={{ color: isSelected ? "#FFF" : theme.text }}>
                        {EVENT_KIND_LABELS[kind]}
                      </AppText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {newEventKind !== "SOLO_TEAM" && newEventKind !== "SHOW_DANSE" && (
              <View style={styles.rowInput}>
                <View style={[styles.inputGroup, styles.flex1MR8]}>
                  <AppText variant="caption" color={theme.textSecondary} style={styles.mb8}>
                    Type
                  </AppText>
                  <FluidSegmentedTab
                    activeValue={newEventType}
                    testID="event-editor-type-tabs"
                    onChange={(v: string) => setNewEventType(v as "Couple" | "Solo")}
                    options={[
                      { label: "Couple", value: "Couple" },
                      { label: "Solo", value: "Solo" },
                    ]}
                  />
                </View>
                <View style={[styles.inputGroup, styles.flex1]}>
                  <AppText variant="caption" color={theme.textSecondary} style={styles.mb8}>
                    Catégorie
                  </AppText>
                  <FluidSegmentedTab
                    activeValue={newEventCategory}
                    testID="event-editor-category-tabs"
                    onChange={(v) => setNewEventCategory(v)}
                    options={[
                      { label: "Latine", value: "Latine" },
                      { label: "Standard", value: "Standard" },
                    ]}
                  />
                </View>
              </View>
            )}

            {newEventKind === "SHOW_DANSE" && (
              <View style={styles.inputGroup}>
                <AppText variant="caption" color={theme.textSecondary} style={styles.mb8}>
                  Catégorie (Latine / Standard)
                </AppText>
                <FluidSegmentedTab
                  activeValue={newEventCategory}
                  onChange={(v) => setNewEventCategory(v)}
                  options={[
                    { label: "Latine", value: "Latine" },
                    { label: "Standard", value: "Standard" },
                  ]}
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <AppText variant="caption" color={theme.textSecondary} style={styles.mb8}>
                {newEventKind === "SOLO_TEAM"
                  ? "Catégorie d'âge de la team"
                  : newEventKind === "OPEN"
                    ? "Catégories d'âge (plusieurs possibles)"
                    : "Age"}
              </AppText>
              <View style={styles.chipRow}>
                {newEventKind === "OPEN"
                  ? ageOptionsForNewEvent.map((opt: string) => {
                      const isSelected = newEventAgeGroups.includes(opt);
                      return (
                        <TouchableOpacity
                          accessibilityRole="button"
                          key={opt}
                          onPress={() => toggleOpenAgeGroup(opt)}
                          style={[
                            styles.chip,
                            styles.chipRadius8,
                            isSelected
                              ? { backgroundColor: theme.primary, borderColor: theme.primary }
                              : { borderColor: theme.border },
                          ]}
                        >
                          <AppText variant="caption" style={{ color: isSelected ? "#FFF" : theme.text }}>
                            {opt}
                          </AppText>
                        </TouchableOpacity>
                      );
                    })
                  : ageOptionsForNewEvent.map((opt: string) => {
                      const isSelected = newEventAge === opt;
                      return (
                        <TouchableOpacity
                          accessibilityRole="button"
                          key={opt}
                          onPress={() => setNewEventAge(opt)}
                          style={[
                            styles.chip,
                            styles.chipRadius8,
                            isSelected
                              ? { backgroundColor: theme.primary, borderColor: theme.primary }
                              : { borderColor: theme.border },
                          ]}
                        >
                          <AppText variant="caption" style={{ color: isSelected ? "#FFF" : theme.text }}>
                            {opt}
                          </AppText>
                        </TouchableOpacity>
                      );
                    })}
              </View>
            </View>

            {newEventKind === "OPEN" && (
              <View style={styles.inputGroup}>
                <AppText variant="caption" color={theme.textSecondary} style={styles.mb8}>
                  Niveaux (optionnel)
                </AppText>
                <AppText variant="caption" style={[styles.mb8, { color: theme.textSecondary }]}>
                  Regrouper des classes d'âge et/ou des niveaux. Aucune sélection = tous niveaux.
                </AppText>
                <View style={styles.chipRow}>
                  {COMPETITION_LEVELS.map((level: string) => {
                    const isSelected = newEventOpenLevels.includes(level);
                    return (
                      <TouchableOpacity
                        key={level}
                        accessibilityRole="button"
                        onPress={() => toggleOpenLevel(level)}
                        style={[
                          styles.chip,
                          styles.chipRadius8,
                          isSelected
                            ? { backgroundColor: theme.primary, borderColor: theme.primary }
                            : { borderColor: theme.border },
                        ]}
                      >
                        <AppText variant="caption" style={{ color: isSelected ? "#FFF" : theme.text }}>
                          {level}
                        </AppText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {(newEventKind === "CLASSIFICATRICE" || newEventKind === "SOLO_TEAM") && (
              <View style={styles.inputGroup}>
                <AppText variant="caption" color={theme.textSecondary} style={styles.mb8}>
                  Niveau
                </AppText>
                <View style={styles.chipRow}>
                  {levelOptionsForNewEvent.map((level: string) => {
                    const isSelected = newEventLevel === level;
                    return (
                      <TouchableOpacity
                        key={level}
                        accessibilityRole="button"
                        onPress={() => setNewEventLevel(level)}
                        style={[
                          styles.chip,
                          styles.chipRadius8,
                          isSelected
                            ? { backgroundColor: theme.primary, borderColor: theme.primary }
                            : { borderColor: theme.border },
                        ]}
                      >
                        <AppText variant="caption" style={{ color: isSelected ? "#FFF" : theme.text }}>
                          {level}
                        </AppText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {newEventKind === "SOLO_TEAM" && (
                  <AppText variant="caption" style={[styles.mt6, { color: theme.textSecondary }]}>
                    Équipe min. 6 danseurs. Niveau défini par le responsable technique.
                  </AppText>
                )}
                {competitionType === "PROXIMITE" && newEventKind === "CLASSIFICATRICE" && (
                  <AppText variant="caption" style={[styles.mt6, { color: theme.textSecondary }]}>
                    En proximité, seuls Débutant et Intermédiaire sont autorisés.
                  </AppText>
                )}
              </View>
            )}
          </ScrollView>

          <View style={styles.actionBtns}>
            <AppButton
              title="Annuler"
              variant="secondary"
              onPress={() => setShowEventModal(false)}
              style={styles.flex1}
            />
            <AppButton
              title="Ajouter"
              testID="event-editor-add-button"
              variant="primary"
              onPress={addEvent}
              style={styles.flex1}
            />
          </View>
        </View>
      </View>
    </Modal>
  </>
);
```

- [ ] **Step 2: Check what CompetitionEvent type looks like in the hook**

```bash
grep -n "CompetitionEvent\|type.*Event\b" /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/apps/client/src/features/club/hooks/useClubCompetitionEditorLogic.ts | head -20
```

If `CompetitionEvent` is not exported by name, use `ReturnType<typeof useClubCompetitionEditorLogic>["events"][number]` for the type of individual events.

- [ ] **Step 3: Replace renderEvents in ClubCompetitionFormScreen**

Import:

```typescript
import { CompetitionEventsTab } from '../components/editor/CompetitionEventsTab';
```

Replace the `renderEvents` function definition and its call (+ the Add Event Modal block) with:

```typescript
{activeTab === "EVENTS" && (
  <CompetitionEventsTab
    theme={theme}
    competitionType={competitionType}
    events={events}
    removeEvent={removeEvent}
    showEventModal={showEventModal}
    setShowEventModal={setShowEventModal}
    newEventKind={newEventKind}
    setNewEventKind={setNewEventKind}
    newEventType={newEventType}
    setNewEventType={setNewEventType}
    newEventCategory={newEventCategory}
    setNewEventCategory={setNewEventCategory}
    newEventAge={newEventAge}
    setNewEventAge={setNewEventAge}
    newEventLevel={newEventLevel}
    setNewEventLevel={setNewEventLevel}
    newEventAgeGroups={newEventAgeGroups}
    toggleOpenAgeGroup={toggleOpenAgeGroup}
    newEventOpenLevels={newEventOpenLevels}
    toggleOpenLevel={toggleOpenLevel}
    allowedEventKindsForCurrentCompetition={allowedEventKindsForCurrentCompetition}
    levelOptionsForNewEvent={levelOptionsForNewEvent}
    ageOptionsForNewEvent={ageOptionsForNewEvent}
    addEvent={addEvent}
  />
)}
```

Remove the Add Event Modal block from the main `return` JSX (lines ~792–1116 in the original).

- [ ] **Step 4: Verify TypeScript**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/apps/client
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition
git add apps/client/src/features/club/components/editor/CompetitionEventsTab.tsx
git add apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx
git commit -m "refactor(club): extract CompetitionEventsTab component"
```

---

### Task 4: Create CompetitionTimingTab

**Files:**

- Create: `apps/client/src/features/club/components/editor/CompetitionTimingTab.tsx`
- Modify: `apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx`

Extract `renderTiming()` + `renderTimingItem()` body AND the Add/Edit Timing Modal (lines 1118–1251).

- [ ] **Step 1: Create CompetitionTimingTab.tsx**

```typescript
// apps/client/src/features/club/components/editor/CompetitionTimingTab.tsx
import DateTimePicker from "@react-native-community/datetimepicker";
import { Clock, Edit2, GripVertical, Plus, Trash2 } from "lucide-react-native";
import React from "react";
import { Modal, Platform, TextInput, TouchableOpacity, View } from "react-native";
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from "react-native-draggable-flatlist";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import { FluidSegmentedTab } from "../../../../components/FluidSegmentedTab";
import { type ScheduleItem } from "../../hooks/useClubCompetitionEditorLogic";
import { styles } from "./competition-editor.styles";

interface Props {
  theme: ReturnType<typeof import("../../../../context/ThemeContext").useTheme>["theme"];
  schedule: ScheduleItem[];
  handleDragEnd: (data: ScheduleItem[]) => void;
  showTimingModal: boolean;
  setShowTimingModal: (v: boolean) => void;
  newTime: Date;
  showTimePicker: boolean;
  setShowTimePicker: (v: boolean) => void;
  newTimeText: string;
  onTimeChange: (event: unknown, date?: Date) => void;
  newTimingType: "ROUND" | "BREAK" | "CEREMONY" | "OTHER";
  setNewTimingType: (t: "ROUND" | "BREAK" | "CEREMONY" | "OTHER") => void;
  newTimingTitle: string;
  setNewTimingTitle: (t: string) => void;
  newTimingDuration: string;
  setNewTimingDuration: (d: string) => void;
  editingTimingId: string | null;
  openTimingModal: (item?: ScheduleItem) => void;
  saveTiming: () => void;
  removeTiming: (id: string) => void;
}

export const CompetitionTimingTab: React.FC<Props> = ({
  theme,
  schedule,
  handleDragEnd,
  showTimingModal,
  setShowTimingModal,
  newTime,
  showTimePicker,
  setShowTimePicker,
  newTimeText,
  onTimeChange,
  newTimingType,
  setNewTimingType,
  newTimingTitle,
  setNewTimingTitle,
  newTimingDuration,
  setNewTimingDuration,
  editingTimingId,
  openTimingModal,
  saveTiming,
  removeTiming,
}) => {
  const renderTimingItem = ({ item, drag, isActive }: RenderItemParams<ScheduleItem>) => {
    const timingItemStyle = {
      backgroundColor: item.type === "BREAK" ? "transparent" : theme.surface,
      borderWidth: item.type === "BREAK" ? 1 : 0,
      borderColor: theme.border,
      opacity: isActive ? 0.7 : 1,
    };
    return (
      <ScaleDecorator>
        <TouchableOpacity
          accessibilityRole="button"
          onLongPress={drag}
          disabled={isActive}
          activeOpacity={1}
          style={[styles.card, timingItemStyle]}
        >
          <TouchableOpacity accessibilityRole="button" onPressIn={drag} style={styles.padding8}>
            <GripVertical size={20} color={theme.textSecondary} />
          </TouchableOpacity>
          <View style={styles.timeAlignCol}>
            <AppText variant="body" weight="600" style={{ color: theme.primary }}>
              {item.startTime}
            </AppText>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              {item.duration} min
            </AppText>
          </View>
          <View style={styles.flex1PadH12}>
            <AppText variant="body" style={{ color: theme.text }} numberOfLines={1}>
              {item.title}
            </AppText>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              {item.type}
            </AppText>
          </View>
          <View style={styles.dirRow}>
            <TouchableOpacity
              accessibilityRole="button"
              testID={`timing-edit-${item.id}`}
              onPress={() => openTimingModal(item)}
              style={styles.iconButton}
            >
              <Edit2 size={18} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              testID={`timing-delete-${item.id}`}
              onPress={() => removeTiming(item.id)}
              style={styles.iconButton}
            >
              <Trash2 size={18} color={theme.danger} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  return (
    <>
      <View style={styles.flex1}>
        <View style={[styles.sectionHeader, styles.mb16PadH20]}>
          <AppText variant="body" style={{ color: theme.textSecondary }}>
            Organisez le planning par glisser-déposer.
          </AppText>
        </View>

        <DraggableFlatList
          data={schedule}
          onDragEnd={({ data }) => handleDragEnd(data)}
          keyExtractor={(item) => item.id}
          renderItem={renderTimingItem}
          contentContainerStyle={styles.organisationContainer}
          ListFooterComponent={
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.addButton, styles.dashedBorderMT12, { borderColor: theme.primary }]}
              onPress={() => openTimingModal()}
            >
              <Plus size={24} color={theme.primary} />
              <AppText variant="button" style={[styles.ml8, { color: theme.primary }]}>
                Ajouter un créneau
              </AppText>
            </TouchableOpacity>
          }
        />
      </View>

      <Modal visible={showTimingModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <AppText variant="h3" style={[styles.mb16, { color: theme.text }]}>
              {editingTimingId ? "Modifier le créneau" : "Ajouter un créneau"}
            </AppText>

            <View style={styles.rowInput}>
              <View style={[styles.inputGroup, styles.flex1MR8]}>
                <AppText variant="caption" color={theme.textSecondary}>
                  Heure
                </AppText>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setShowTimePicker(true)}
                  style={[styles.inputContainer, { backgroundColor: theme.background, borderColor: theme.border }]}
                >
                  <Clock size={20} color={theme.textSecondary} style={styles.inputIcon} />
                  <AppText variant="body" style={{ color: theme.text }}>
                    {newTimeText}
                  </AppText>
                </TouchableOpacity>
                {showTimePicker && (
                  <DateTimePicker
                    value={newTime}
                    mode="time"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={onTimeChange}
                    is24Hour={true}
                  />
                )}
              </View>

              <View style={[styles.inputGroup, styles.w100]}>
                <AppText variant="caption" color={theme.textSecondary}>
                  Durée (min)
                </AppText>
                <View style={[styles.inputContainer, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <TextInput
                    accessibilityLabel="Text input field"
                    accessibilityHint="Saisissez la durée"
                    style={[styles.input, styles.textCenter, { color: theme.text }]}
                    keyboardType="numeric"
                    value={newTimingDuration}
                    onChangeText={setNewTimingDuration}
                  />
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <AppText variant="caption" color={theme.textSecondary}>
                Type
              </AppText>
              <FluidSegmentedTab
                activeValue={newTimingType}
                onChange={(v: string) => setNewTimingType(v as "ROUND" | "BREAK" | "CEREMONY" | "OTHER")}
                options={[
                  { label: "Tour", value: "ROUND" },
                  { label: "Pause", value: "BREAK" },
                  { label: "Cérémonie", value: "CEREMONY" },
                ]}
              />
            </View>

            <View style={styles.inputGroup}>
              <AppText variant="caption" color={theme.textSecondary}>
                Titre
              </AppText>
              <TextInput
                accessibilityLabel="Text input field"
                accessibilityHint="Saisissez le titre du créneau"
                testID="timing-title-input"
                style={[styles.input, styles.borderBox, { color: theme.text, borderColor: theme.border }]}
                placeholder="Ex: Finale Latine Adulte"
                placeholderTextColor={theme.textSecondary}
                value={newTimingTitle}
                onChangeText={setNewTimingTitle}
              />
            </View>

            <View style={styles.actionBtns}>
              <AppButton
                title="Annuler"
                variant="secondary"
                onPress={() => setShowTimingModal(false)}
                style={styles.flex1}
              />
              <AppButton
                title="Sauvegarder"
                variant="primary"
                onPress={saveTiming}
                style={styles.flex1}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};
```

- [ ] **Step 2: Replace renderTiming in ClubCompetitionFormScreen**

Import:

```typescript
import { CompetitionTimingTab } from '../components/editor/CompetitionTimingTab';
```

Replace `renderTimingItem`, `renderTiming`, their call `{activeTab === "TIMING" && renderTiming()}`, and the Timing Modal block (lines ~1118–1251 original) with:

```typescript
{activeTab === "TIMING" && (
  <CompetitionTimingTab
    theme={theme}
    schedule={schedule}
    handleDragEnd={handleDragEnd}
    showTimingModal={showTimingModal}
    setShowTimingModal={setShowTimingModal}
    newTime={newTime}
    showTimePicker={showTimePicker}
    setShowTimePicker={setShowTimePicker}
    newTimeText={newTimeText}
    onTimeChange={onTimeChange}
    newTimingType={newTimingType}
    setNewTimingType={setNewTimingType}
    newTimingTitle={newTimingTitle}
    setNewTimingTitle={setNewTimingTitle}
    newTimingDuration={newTimingDuration}
    setNewTimingDuration={setNewTimingDuration}
    editingTimingId={editingTimingId}
    openTimingModal={openTimingModal}
    saveTiming={saveTiming}
    removeTiming={removeTiming}
  />
)}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/apps/client
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition
git add apps/client/src/features/club/components/editor/CompetitionTimingTab.tsx
git add apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx
git commit -m "refactor(club): extract CompetitionTimingTab component"
```

---

### Task 5: Create CompetitionOrganisationTab

**Files:**

- Create: `apps/client/src/features/club/components/editor/CompetitionOrganisationTab.tsx`
- Modify: `apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx`

Extract `renderOrganisation()` body AND the Layout Modal (lines 1253–1532) AND the Volunteer Access Modal (1534–1612).

- [ ] **Step 1: Create CompetitionOrganisationTab.tsx**

```typescript
// apps/client/src/features/club/components/editor/CompetitionOrganisationTab.tsx
import * as Clipboard from "expo-clipboard";
import { Copy, Users, X } from "lucide-react-native";
import React from "react";
import { Alert, Modal, ScrollView, TextInput, TouchableOpacity, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import { LayoutCanvas } from "../LayoutCanvas";
import { styles } from "./competition-editor.styles";

interface VolunteerToken {
  accessUrl: string;
}

interface LayoutItem {
  id: string;
  type: "TABLE" | "GRADIN" | "OTHER";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  capacity?: number;
  rows?: number;
  cols?: number;
  seatLocked?: boolean;
  orientation?: string;
}

interface Props {
  theme: ReturnType<typeof import("../../../../context/ThemeContext").useTheme>["theme"];
  volunteerToken: VolunteerToken | null;
  setVolunteerToken: (t: VolunteerToken | null) => void;
  isGeneratingToken: boolean;
  handleGenerateVolunteerToken: () => Promise<void>;
  ticketingUrl: string;
  setTicketingUrl: (u: string) => void;
  layoutItems: LayoutItem[];
  showLayoutModal: boolean;
  setShowLayoutModal: (v: boolean) => void;
  newLayoutType: "TABLE" | "GRADIN" | "OTHER";
  setNewLayoutType: (t: "TABLE" | "GRADIN" | "OTHER") => void;
  newLayoutLabel: string;
  setNewLayoutLabel: (l: string) => void;
  newLayoutCapacity: string;
  setNewLayoutCapacity: (c: string) => void;
  newLayoutRows: string;
  setNewLayoutRows: (r: string) => void;
  newLayoutCols: string;
  setNewLayoutCols: (c: string) => void;
  newLayoutX: number;
  setNewLayoutX: (x: number) => void;
  newLayoutY: number;
  setNewLayoutY: (y: number) => void;
  newLayoutWidth: number;
  setNewLayoutWidth: (w: number) => void;
  newLayoutHeight: number;
  setNewLayoutHeight: (h: number) => void;
  newLayoutRotation: string;
  setNewLayoutRotation: (r: string) => void;
  openLayoutModal: (item?: LayoutItem, type?: "TABLE" | "GRADIN" | "OTHER") => void;
  updateLayoutItemPosition: (id: string, x: number, y: number) => void;
  toggleLayoutItemSeatLock: (id: string) => void;
  cycleLayoutItemOrientation: (id: string) => void;
  editingLayoutItem: LayoutItem | null;
  addLayoutItem: () => void;
  removeLayoutItem: (id: string) => void;
  duplicateLayoutItem: (id: string) => void;
}

export const CompetitionOrganisationTab: React.FC<Props> = ({
  theme,
  volunteerToken,
  setVolunteerToken,
  isGeneratingToken,
  handleGenerateVolunteerToken,
  ticketingUrl,
  setTicketingUrl,
  layoutItems,
  showLayoutModal,
  setShowLayoutModal,
  newLayoutType,
  setNewLayoutType,
  newLayoutLabel,
  setNewLayoutLabel,
  newLayoutCapacity,
  setNewLayoutCapacity,
  newLayoutRows,
  setNewLayoutRows,
  newLayoutCols,
  setNewLayoutCols,
  newLayoutX,
  setNewLayoutX,
  newLayoutY,
  setNewLayoutY,
  newLayoutWidth,
  setNewLayoutWidth,
  newLayoutHeight,
  setNewLayoutHeight,
  newLayoutRotation,
  setNewLayoutRotation,
  openLayoutModal,
  updateLayoutItemPosition,
  toggleLayoutItemSeatLock,
  cycleLayoutItemOrientation,
  editingLayoutItem,
  addLayoutItem,
  removeLayoutItem,
  duplicateLayoutItem,
}) => (
  <>
    <ScrollView style={[styles.scrollContent, styles.organisationContainer]}>
      <View style={styles.organisationDesc}>
        <AppText variant="body" style={{ color: theme.textSecondary }}>
          Gérez les accès pour vos collaborateurs et bénévoles.
        </AppText>
      </View>

      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <View style={styles.infoRow}>
          <View style={[styles.iconContainer, { backgroundColor: `${theme.primary}20` }]}>
            <Users size={20} color={theme.primary} />
          </View>
          <View style={styles.flex1ML12}>
            <AppText variant="body" weight="600" style={{ color: theme.text }}>
              Accès Bénévoles
            </AppText>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Permet de scanner sans compte FFD
            </AppText>
          </View>
        </View>
        <View style={styles.mt16}>
          <AppButton
            title="Générer un QR d'accès"
            onPress={() => { handleGenerateVolunteerToken().catch(() => {}); }}
            loading={isGeneratingToken}
            variant="outline"
          />
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: theme.surface }, styles.mt16]}>
        <AppText variant="h3" style={[styles.mb12, { color: theme.text }]}>
          Billetterie HelloAsso
        </AppText>
        <AppText variant="body" style={[styles.mb16, { color: theme.textSecondary }]}>
          Lien vers votre billetterie HelloAsso pour l'achat de places.
        </AppText>
        <TextInput
          accessibilityLabel="Lien HelloAsso"
          accessibilityHint="Lien vers la billetterie HelloAsso de la compétition"
          style={styles.ticketingInput}
          placeholder="https://www.helloasso.com/associations/..."
          placeholderTextColor={theme.textSecondary}
          value={ticketingUrl}
          onChangeText={setTicketingUrl}
        />
      </View>

      <View style={[styles.section, styles.layoutSection]}>
        <View style={styles.layoutHeader}>
          <AppText variant="h3" style={{ color: theme.text }}>
            Plan de salle
          </AppText>
        </View>
        <AppText variant="body" style={[styles.organisationDescription, { color: theme.textSecondary }]}>
          Piste au centre. Pincez pour zoomer et faites glisser la vue si besoin. Appuyez sur un
          élément pour ouvrir le détail, et double‑touchez pour dupliquer rapidement. Vous pouvez
          verrouiller des places pour les rendre non réservable avant d'ouvrir la billetterie.
        </AppText>
        <LayoutCanvas
          layoutItems={layoutItems}
          theme={theme}
          onAddElement={(type) => openLayoutModal(undefined, type)}
          onEditElement={(item) => openLayoutModal(item)}
          onQuickEditElement={(item) => duplicateLayoutItem(item.id)}
          onPositionChange={updateLayoutItemPosition}
          onToggleSeatLock={toggleLayoutItemSeatLock}
          onCycleOrientation={cycleLayoutItemOrientation}
        />
      </View>
    </ScrollView>

    {/* Layout Item Modal */}
    <Modal visible={showLayoutModal} transparent animationType="slide" onRequestClose={() => setShowLayoutModal(false)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.surface }, styles.maxH80pct]}>
          <AppText variant="h3" style={[styles.modalTitle, { color: theme.text }]}>
            {editingLayoutItem ? "Modifier l'élément" : "Ajouter un élément"}
          </AppText>

          <View style={styles.inputGroup}>
            <AppText variant="caption" color={theme.textSecondary}>
              Type d'élément
            </AppText>
            <View style={styles.tagRowMT8}>
              {(["TABLE", "GRADIN", "OTHER"] as const).map((type) => {
                const isSelected = newLayoutType === type;
                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={type === "TABLE" ? "Table" : type === "GRADIN" ? "Gradin" : "Autre"}
                    accessibilityHint={`Sélectionner le type ${type}`}
                    key={type}
                    onPress={() => setNewLayoutType(type)}
                    style={[
                      styles.layoutTypeChip,
                      {
                        backgroundColor: isSelected ? theme.primary : `${theme.primary}10`,
                        borderColor: theme.primary,
                      },
                    ]}
                  >
                    <AppText variant="caption" style={{ color: isSelected ? "#FFF" : theme.primary }}>
                      {type === "TABLE" ? "Table" : type === "GRADIN" ? "Gradin" : "Autre"}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.inputGroup, styles.mt16]}>
            <AppText variant="caption" color={theme.textSecondary}>
              Nom / Numéro
            </AppText>
            <TextInput
              accessibilityLabel="Nom de l'élément"
              accessibilityHint="Saisissez le nom ou le numéro de la table ou du gradin"
              style={[styles.input, styles.borderBox, { color: theme.text, borderColor: theme.border }]}
              placeholder="Ex: Table 1 ou Gradin Nord"
              placeholderTextColor={theme.textSecondary}
              value={newLayoutLabel}
              onChangeText={setNewLayoutLabel}
            />
          </View>

          {newLayoutType === "GRADIN" && (
            <View style={styles.rowInput}>
              <View style={[styles.inputGroup, styles.flex1MR8]}>
                <AppText variant="caption" color={theme.textSecondary}>Colonnes</AppText>
                <TextInput
                  accessibilityLabel="Nombre de colonnes"
                  style={[styles.ticketingInput, { color: theme.text }]}
                  keyboardType="numeric"
                  placeholder="4"
                  placeholderTextColor={theme.textSecondary}
                  value={newLayoutCols}
                  onChangeText={setNewLayoutCols}
                />
              </View>
              <View style={[styles.inputGroup, styles.flex1]}>
                <AppText variant="caption" color={theme.textSecondary}>Lignes (rangs)</AppText>
                <TextInput
                  accessibilityLabel="Nombre de lignes"
                  style={[styles.ticketingInput, { color: theme.text }]}
                  keyboardType="numeric"
                  placeholder="3"
                  placeholderTextColor={theme.textSecondary}
                  value={newLayoutRows}
                  onChangeText={setNewLayoutRows}
                />
              </View>
            </View>
          )}
          {newLayoutType === "GRADIN" && (
            <AppText variant="caption" style={[styles.negMt8Mb8, { color: theme.textSecondary }]}>
              {(parseInt(newLayoutRows, 10) || 0) * (parseInt(newLayoutCols, 10) || 0)} places
            </AppText>
          )}

          {newLayoutType === "TABLE" && (
            <View style={[styles.inputGroup, styles.mt16]}>
              <AppText variant="caption" color={theme.textSecondary}>Nombre de places</AppText>
              <TextInput
                accessibilityLabel="Nombre de places à la table"
                style={[styles.ticketingInput, { color: theme.text }]}
                placeholder="8"
                keyboardType="numeric"
                placeholderTextColor={theme.textSecondary}
                value={newLayoutCapacity}
                onChangeText={setNewLayoutCapacity}
              />
            </View>
          )}

          {newLayoutType === "OTHER" && (
            <View style={[styles.inputGroup, styles.mt16]}>
              <AppText variant="caption" color={theme.textSecondary}>Capacité (places)</AppText>
              <TextInput
                accessibilityLabel="Capacité"
                style={[styles.ticketingInput, { color: theme.text }]}
                placeholder="8"
                keyboardType="numeric"
                placeholderTextColor={theme.textSecondary}
                value={newLayoutCapacity}
                onChangeText={setNewLayoutCapacity}
              />
            </View>
          )}

          <View style={[styles.inputGroup, styles.mt16]}>
            <AppText variant="caption" color={theme.textSecondary}>Rotation (°)</AppText>
            <TextInput
              accessibilityLabel="Rotation de l'élément en degrés"
              style={[styles.ticketingInput, { color: theme.text }]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              value={newLayoutRotation}
              onChangeText={setNewLayoutRotation}
            />
          </View>

          {editingLayoutItem && (
            <>
              <View style={styles.rowInput}>
                <View style={[styles.inputGroup, styles.flex1MR8]}>
                  <AppText variant="caption" color={theme.textSecondary}>Position X (%)</AppText>
                  <TextInput
                    accessibilityLabel="Position X"
                    style={[styles.ticketingInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={newLayoutX.toString()}
                    onChangeText={(v) => setNewLayoutX(parseInt(v, 10) || 0)}
                  />
                </View>
                <View style={[styles.inputGroup, styles.flex1]}>
                  <AppText variant="caption" color={theme.textSecondary}>Position Y (%)</AppText>
                  <TextInput
                    accessibilityLabel="Position Y"
                    style={[styles.ticketingInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={newLayoutY.toString()}
                    onChangeText={(v) => setNewLayoutY(parseInt(v, 10) || 0)}
                  />
                </View>
              </View>
              <View style={styles.rowInput}>
                <View style={[styles.inputGroup, styles.flex1MR8]}>
                  <AppText variant="caption" color={theme.textSecondary}>Largeur (%)</AppText>
                  <TextInput
                    accessibilityLabel="Largeur"
                    style={[styles.ticketingInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={newLayoutWidth.toString()}
                    onChangeText={(v) => setNewLayoutWidth(parseInt(v, 10) || 0)}
                  />
                </View>
                <View style={[styles.inputGroup, styles.flex1]}>
                  <AppText variant="caption" color={theme.textSecondary}>Hauteur (%)</AppText>
                  <TextInput
                    accessibilityLabel="Hauteur"
                    style={[styles.ticketingInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={newLayoutHeight.toString()}
                    onChangeText={(v) => setNewLayoutHeight(parseInt(v, 10) || 0)}
                  />
                </View>
              </View>
            </>
          )}

          <View style={styles.modalRow}>
            {editingLayoutItem && (
              <AppButton
                title="Supprimer"
                variant="danger"
                onPress={() => {
                  removeLayoutItem(editingLayoutItem.id);
                  setShowLayoutModal(false);
                }}
                style={styles.modalAction}
              />
            )}
            <AppButton title="Annuler" variant="secondary" onPress={() => setShowLayoutModal(false)} style={styles.flex1} />
            <AppButton title={editingLayoutItem ? "Modifier" : "Ajouter"} variant="primary" onPress={addLayoutItem} style={styles.flex2} />
          </View>
        </View>
      </View>
    </Modal>

    {/* Volunteer Access Modal */}
    <Modal visible={!!volunteerToken} transparent animationType="fade" onRequestClose={() => setVolunteerToken(null)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.surface }, styles.minH400]}>
          <View style={styles.rowBetweenMB16}>
            <AppText variant="h3" style={{ color: theme.text }}>
              Accès Bénévole
            </AppText>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              accessibilityHint="Fermer la fenêtre d'accès bénévole"
              onPress={() => setVolunteerToken(null)}
            >
              <X color={theme.text} size={24} />
            </TouchableOpacity>
          </View>

          <AppText variant="body" style={[styles.mb24, { color: theme.textSecondary }]}>
            Le bénévole doit scanner ce QR code pour accéder à l'interface de check-in.
          </AppText>

          <View style={styles.qrContainer}>
            {volunteerToken && (
              <QRCode value={volunteerToken.accessUrl} size={200} color="#000" backgroundColor="#FFF" />
            )}
          </View>

          <View style={styles.mt24}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Copier le lien d'accès"
              accessibilityHint="Copie l'URL d'accès bénévole dans le presse-papier"
              style={[styles.copyButton, { backgroundColor: `${theme.primary}20` }]}
              onPress={() => {
                if (volunteerToken) {
                  Clipboard.setStringAsync(volunteerToken.accessUrl)
                    .then(() => Alert.alert("Succès", "Lien copié dans le presse-papier"))
                    .catch(() => {});
                }
              }}
            >
              <Copy color={theme.primary} size={20} />
              <AppText style={[styles.ml8w600, { color: theme.primary }]}>Copier le lien</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  </>
);
```

- [ ] **Step 2: Check actual LayoutItem and VolunteerToken types from the hook**

```bash
grep -n "layoutItems\|volunteerToken\|LayoutItem\|VolunteerToken" /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/apps/client/src/features/club/hooks/useClubCompetitionEditorLogic.ts | head -20
```

Adjust the `LayoutItem` and `VolunteerToken` interface definitions in the component to match what the hook actually returns. If the types are exported from the hook, import them instead of re-declaring them.

- [ ] **Step 3: Replace renderOrganisation in ClubCompetitionFormScreen**

Import:

```typescript
import { CompetitionOrganisationTab } from '../components/editor/CompetitionOrganisationTab';
```

Replace the `renderOrganisation` function definition, its call `{activeTab === "ORGANISATION" && renderOrganisation()}`, the Layout Modal block, and the Volunteer Access Modal block with:

```typescript
{activeTab === "ORGANISATION" && (
  <CompetitionOrganisationTab
    theme={theme}
    volunteerToken={volunteerToken}
    setVolunteerToken={setVolunteerToken}
    isGeneratingToken={isGeneratingToken}
    handleGenerateVolunteerToken={handleGenerateVolunteerToken}
    ticketingUrl={ticketingUrl}
    setTicketingUrl={setTicketingUrl}
    layoutItems={layoutItems}
    showLayoutModal={showLayoutModal}
    setShowLayoutModal={setShowLayoutModal}
    newLayoutType={newLayoutType}
    setNewLayoutType={setNewLayoutType}
    newLayoutLabel={newLayoutLabel}
    setNewLayoutLabel={setNewLayoutLabel}
    newLayoutCapacity={newLayoutCapacity}
    setNewLayoutCapacity={setNewLayoutCapacity}
    newLayoutRows={newLayoutRows}
    setNewLayoutRows={setNewLayoutRows}
    newLayoutCols={newLayoutCols}
    setNewLayoutCols={setNewLayoutCols}
    newLayoutX={newLayoutX}
    setNewLayoutX={setNewLayoutX}
    newLayoutY={newLayoutY}
    setNewLayoutY={setNewLayoutY}
    newLayoutWidth={newLayoutWidth}
    setNewLayoutWidth={setNewLayoutWidth}
    newLayoutHeight={newLayoutHeight}
    setNewLayoutHeight={setNewLayoutHeight}
    newLayoutRotation={newLayoutRotation}
    setNewLayoutRotation={setNewLayoutRotation}
    openLayoutModal={openLayoutModal}
    updateLayoutItemPosition={updateLayoutItemPosition}
    toggleLayoutItemSeatLock={toggleLayoutItemSeatLock}
    cycleLayoutItemOrientation={cycleLayoutItemOrientation}
    editingLayoutItem={editingLayoutItem}
    addLayoutItem={addLayoutItem}
    removeLayoutItem={removeLayoutItem}
    duplicateLayoutItem={duplicateLayoutItem}
  />
)}
```

Also clean up now-unused imports in ClubCompetitionFormScreen.tsx (Clipboard, QRCode, Copy, Users, etc.).

- [ ] **Step 4: Verify TypeScript**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/apps/client
npx tsc --noEmit 2>&1 | head -50
```

Expected: 0 new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition
git add apps/client/src/features/club/components/editor/CompetitionOrganisationTab.tsx
git add apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx
git commit -m "refactor(club): extract CompetitionOrganisationTab component"
```

---

### Task 6: Clean up ClubCompetitionFormScreen

**Files:**

- Modify: `apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx`

After all 4 tab components are extracted, the screen should only have: imports, type, hook invocation, and the main return with header + tab switcher + footer.

- [ ] **Step 1: Remove all now-unused imports**

Check which imports remain necessary:

- Keep: `NativeStackScreenProps`, `React`, `View`, `TouchableOpacity`, `SafeAreaView`, `GestureHandlerRootView`, `X`, `AppButton`, `AppText`, `FluidSegmentedTab`, `useTheme`, `useClubCompetitionEditorLogic`, `RootStackParamList`
- Remove any that are only used in extracted components (e.g., `DateTimePicker`, `Clipboard`, `Modal`, `ScrollView`, `TextInput`, `Platform`, `DraggableFlatList`, `GooglePlacesAutocomplete`, `QRCode`, all lucide icons except `X`, etc.)

- [ ] **Step 2: Verify TypeScript compiles clean**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/apps/client
npx tsc --noEmit 2>&1 | head -50
```

Expected: 0 errors.

- [ ] **Step 3: Count lines to confirm reduction**

```bash
wc -l /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition/apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx
```

Expected: ~150 lines (down from 1839).

- [ ] **Step 4: Commit**

```bash
cd /Users/gabin/Development/FFD-Connect/.worktrees/club-competition-form-decomposition
git add apps/client/src/features/club/screens/ClubCompetitionFormScreen.tsx
git commit -m "refactor(club): clean up ClubCompetitionFormScreen imports after extraction"
```
