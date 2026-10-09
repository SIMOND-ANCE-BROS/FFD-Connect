import { useNavigation } from "@react-navigation/native";
import { Plus } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { useTheme } from "../../../context/ThemeContext";
import { DanceOrderEditor } from "../components/DanceOrderEditor";
import { RoundCard } from "../components/RoundCard";
import { usePerformanceEngine } from "../hooks/usePerformanceEngine";
import {
  isOfficialOrder,
  useDanceOrderStore,
} from "../../../stores/danceOrder.store";
import {
  usePerformanceStore,
  type Category,
} from "../../../stores/performance.store";
import {
  addGroup,
  addRound,
  isPasoDoble,
  removeGroup,
  removeRound,
  setGroupCategory,
  setRoundType,
  toggleRoundDance,
} from "../utils/competitionProgram";

const CATEGORIES: Category[] = ["Standard", "Latin"];

export const PerformanceSetupScreen = () => {
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);
  const {
    config,
    setConfig,
    startPerformance,
    stopPerformance,
    status,
    loadingProgress,
  } = usePerformanceEngine();
  const navigation = useNavigation<{
    navigate: (screen: string) => void;
    goBack: () => void;
    isFocused?: () => boolean;
  }>();
  const isLoading = status === "loading";

  // Leaving the setup screen while the competition is loading cancels it
  // (the engine is a singleton: it would otherwise start on another screen).
  const stopRef = useRef(stopPerformance);
  stopRef.current = stopPerformance;
  useEffect(
    () => () => {
      if (usePerformanceStore.getState().status === "loading") {
        stopRef.current();
      }
    },
    [],
  );

  const updateConfig = <K extends "duration" | "pauseDuration" | "pasoClashes">(
    key: K,
    value: (typeof config)[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const danceOrder = useDanceOrderStore((s) => s.danceOrder);
  const setCategoryOrder = useDanceOrderStore((s) => s.setCategoryOrder);
  const resetDanceOrder = useDanceOrderStore((s) => s.resetDanceOrder);
  // Only the categories danced somewhere in the programme are reorderable.
  const programCategories = CATEGORIES.filter((c) =>
    config.rounds.some((r) => r.groups.includes(c)),
  );

  const hasPaso = config.rounds.some(
    (r) => r.groups.includes("Latin") && r.dances.Latin.some(isPasoDoble),
  );

  // Validation (≥ 1 dance per round, tracks available for every dance) is
  // done by the engine once the full catalogue is loaded, with a French Alert.
  const handleStart = async () => {
    if (isLoading) return;
    const started = await startPerformance();
    // Only if this session is still the running one (not cancelled with
    // « Annuler ») and the user is still on this screen.
    const runningStatus = usePerformanceStore.getState().status;
    const stillRunning =
      runningStatus === "break" ||
      runningStatus === "playing" ||
      runningStatus === "paused";
    const focused = navigation.isFocused?.() ?? true;
    if (started && stillRunning && focused) {
      navigation.navigate("PerformancePlayer");
    } else if (started && stillRunning) {
      stopPerformance();
    }
  };

  const startTitle = isLoading
    ? loadingProgress && loadingProgress.total > 0
      ? `CHARGEMENT… ${loadingProgress.done}/${loadingProgress.total}`
      : "PRÉPARATION…"
    : "DÉMARRER";

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
      edges={["left", "right"]}
    >
      <NestableScrollContainer
        contentContainerStyle={{
          ...styles.content,
          paddingTop: headerH,
        }}
      >
        {/* Programme de tours */}
        <View style={styles.section}>
          <AppText
            variant="caption"
            weight="600"
            color={currentTheme.textSecondary}
            style={styles.sectionLabel}
          >
            Programme
          </AppText>
          {config.rounds.map((round, index) => (
            <RoundCard
              key={round.id}
              round={round}
              index={index}
              canDelete={config.rounds.length > 1}
              onTypeChange={(type) => setConfig(setRoundType(round.id, type))}
              onAddGroup={() => setConfig(addGroup(round.id))}
              onRemoveGroup={(g) => setConfig(removeGroup(round.id, g))}
              onGroupCategoryChange={(g, category) =>
                setConfig(setGroupCategory(round.id, g, category))
              }
              onToggleDance={(category, dance) =>
                setConfig(toggleRoundDance(round.id, category, dance))
              }
              onDelete={() => setConfig(removeRound(round.id))}
              danceOrder={danceOrder}
            />
          ))}
          <TouchableOpacity
            onPress={() => setConfig(addRound)}
            style={[
              styles.addRoundButton,
              { borderColor: currentTheme.primary },
            ]}
            testID="performance-add-round-button"
            accessibilityRole="button"
            accessibilityLabel="Ajouter un tour"
            accessibilityHint="Ajoute un tour au programme de la compétition"
          >
            <Plus color={currentTheme.primary} size={18} />
            <AppText variant="body" weight="600" color={currentTheme.primary}>
              Ajouter un tour
            </AppText>
          </TouchableOpacity>
        </View>

        {/* Dance order (per category, every round), persisted on the device */}
        <View style={styles.section}>
          <AppText
            variant="caption"
            weight="600"
            color={currentTheme.textSecondary}
            style={styles.sectionLabel}
          >
            Ordre des danses
          </AppText>
          <DanceOrderEditor
            categories={programCategories}
            danceOrder={danceOrder}
            isOfficial={isOfficialOrder(danceOrder)}
            onChange={setCategoryOrder}
            onReset={() => resetDanceOrder()}
          />
        </View>

        {/* Durations */}
        <View style={styles.section}>
          <AppText
            variant="caption"
            weight="600"
            color={currentTheme.textSecondary}
            style={styles.sectionLabel}
          >
            Temps
          </AppText>
          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <AppText
                variant="caption"
                style={styles.inputLabel}
                color={currentTheme.textSecondary}
              >
                Durée Danse (s)
              </AppText>
              <TextInput
                testID="performance-setup-duration-input"
                accessibilityLabel="Durée de la danse en secondes"
                accessibilityHint="Saisissez la durée de chaque danse en secondes"
                style={[
                  styles.input,
                  {
                    backgroundColor: currentTheme.surface,
                    color: currentTheme.text,
                    borderColor: currentTheme.border,
                  },
                ]}
                keyboardType="numeric"
                value={config.duration.toString()}
                onChangeText={(t) =>
                  updateConfig("duration", parseInt(t, 10) || 0)
                }
              />
            </View>
          </View>
          <View style={styles.inputRowLargeTop}>
            <View style={styles.inputGroup}>
              <AppText
                variant="caption"
                style={styles.inputLabel}
                color={currentTheme.textSecondary}
              >
                Pause entre passages (s)
              </AppText>
              <TextInput
                testID="performance-setup-pause-duration-input"
                accessibilityLabel="Durée de la pause en secondes"
                accessibilityHint="Saisissez la durée de la pause entre chaque passage en secondes"
                style={[
                  styles.input,
                  {
                    backgroundColor: currentTheme.surface,
                    color: currentTheme.text,
                    borderColor: currentTheme.border,
                  },
                ]}
                keyboardType="numeric"
                value={config.pauseDuration.toString()}
                onChangeText={(t) =>
                  updateConfig("pauseDuration", parseInt(t, 10) || 0)
                }
              />
            </View>
          </View>
        </View>

        {/* Paso Settings (Latin rounds containing the Paso Doble) */}
        {hasPaso && (
          <View style={styles.section}>
            <AppText
              variant="caption"
              weight="600"
              color={currentTheme.textSecondary}
              style={styles.sectionLabel}
            >
              Paso Doble
            </AppText>
            <FluidSegmentedTab
              testID="performance-setup-paso-tab"
              activeValue={config.pasoClashes.toString()}
              onChange={(val) =>
                updateConfig("pasoClashes", parseInt(val, 10) as 2 | 3)
              }
              options={[
                { label: "2 Clashs", value: "2" },
                { label: "3 Clashs", value: "3" },
              ]}
            />
          </View>
        )}

        <View style={styles.footer}>
          <AppButton
            title={startTitle}
            onPress={() => {
              handleStart().catch(() => {});
            }}
            disabled={isLoading}
            variant="primary"
            textStyle={styles.startButtonText}
            testID="performance-setup-start-button"
            accessibilityLabel="Démarrer la compétition"
            accessibilityHint="Lance la session avec les paramètres configurés"
          />
          {isLoading && (
            <AppButton
              title="Annuler"
              onPress={stopPerformance}
              variant="secondary"
              style={styles.cancelButton}
              testID="performance-setup-cancel-button"
              accessibilityLabel="Annuler le chargement"
              accessibilityHint="Arrête la préparation de la compétition"
            />
          )}
          {isLoading && (
            <AppText
              variant="caption"
              color={currentTheme.textSecondary}
              style={styles.loadingHint}
              testID="performance-setup-loading-hint"
            >
              Téléchargement des musiques et des annonces avant le départ…
            </AppText>
          )}
        </View>
      </NestableScrollContainer>

      <PinnedHeader
        theme={currentTheme}
        isDark={isDark}
        title="Mode Compétition"
        onHeightChange={setHeaderH}
        left={<BackButton onPress={() => navigation.goBack()} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 5,
    marginRight: 15,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 25,
  },
  inputRow: {
    flexDirection: "row",
    gap: 15,
  },
  inputGroup: {
    flex: 1,
  },
  input: {
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
  },
  addRoundButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 14,
    paddingVertical: 14,
  },
  sectionLabel: {
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  inputLabel: {
    marginBottom: 5,
  },
  inputRowLargeTop: {
    flexDirection: "row",
    gap: 15,
    marginTop: 15,
  },
  footer: {
    marginTop: 20,
  },
  cancelButton: {
    marginTop: 12,
  },
  loadingHint: {
    marginTop: 10,
    textAlign: "center",
  },
  startButtonText: {
    letterSpacing: 1,
    fontWeight: "bold",
  },
});
