import { useNavigation } from "@react-navigation/native";
import React, { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
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
import { Category, Mode } from "../context/PerformanceContext";
import { usePerformanceEngine } from "../hooks/usePerformanceEngine";

const DANCES = {
  Standard: ["Valse Lente", "Tango", "Vienne", "Slow Fox", "Quickstep"],
  Latin: ["Samba", "Cha-Cha-Cha", "Rumba", "Paso Doble", "Jive"],
};

export const PerformanceSetupScreen = () => {
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);
  const { config, setConfig, startPerformance } = usePerformanceEngine();
  const navigation = useNavigation<{
    navigate: (screen: string) => void;
    goBack: () => void;
  }>();

  const updateConfig = <K extends keyof typeof config>(
    key: K,
    value: (typeof config)[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const toggleDance = (dance: string) => {
    setConfig((prev) => {
      const current = prev.selectedDances;
      if (current.includes(dance)) {
        return { ...prev, selectedDances: current.filter((d) => d !== dance) };
      } else {
        return { ...prev, selectedDances: [...current, dance] };
      }
    });
  };

  const handleStart = async () => {
    if (config.mode === "Round" && (config.numberOfHeats || 0) < 2) {
      Alert.alert(
        "Configuration invalide",
        "Le mode Passage nécessite au moins 2 passages.",
      );
      return;
    }
    const started = await startPerformance();
    if (started) {
      navigation.navigate("PerformancePlayer");
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
      edges={["left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          ...styles.content,
          paddingTop: headerH + 8,
        }}
      >
        {/* Mode Selector */}
        <View style={styles.section}>
          <AppText
            variant="caption"
            weight="600"
            color={currentTheme.textSecondary}
            style={styles.sectionLabel}
          >
            Mode
          </AppText>
          <FluidSegmentedTab
            testID="performance-setup-mode-tab"
            activeValue={config.mode}
            onChange={(val) => {
              const mode = val as Mode;
              updateConfig("mode", mode);
              if (mode === "Round" && (config.numberOfHeats || 0) < 2) {
                updateConfig("numberOfHeats", 2);
              }
            }}
            options={[
              { label: "Passage", value: "Round" },
              { label: "Finale", value: "Final" },
            ]}
          />
        </View>

        {/* Category Selector */}
        <View style={styles.section}>
          <AppText
            variant="caption"
            weight="600"
            color={currentTheme.textSecondary}
            style={styles.sectionLabel}
          >
            Catégorie
          </AppText>
          <FluidSegmentedTab
            testID="performance-setup-category-tab"
            activeValue={config.category}
            onChange={(val) => {
              const cat = val as Category;
              updateConfig("category", cat);
              updateConfig("selectedDances", DANCES[cat]);
            }}
            options={[
              { label: "Latines", value: "Latin" },
              { label: "Standards", value: "Standard" },
            ]}
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
            {config.mode === "Round" && (
              <View style={styles.inputGroup}>
                <AppText
                  variant="caption"
                  style={styles.inputLabel}
                  color={currentTheme.textSecondary}
                >
                  Passages
                </AppText>
                <TextInput
                  testID="performance-setup-heats-input"
                  accessibilityLabel="Nombre de passages"
                  accessibilityHint="Saisissez le nombre de passages pour la compétition"
                  style={[
                    styles.input,
                    {
                      backgroundColor: currentTheme.surface,
                      color: currentTheme.text,
                      borderColor: currentTheme.border,
                    },
                  ]}
                  keyboardType="numeric"
                  value={
                    config.numberOfHeats ? config.numberOfHeats.toString() : ""
                  }
                  onChangeText={(t) =>
                    updateConfig(
                      "numberOfHeats",
                      t === "" ? 0 : parseInt(t, 10),
                    )
                  }
                  onEndEditing={() => {
                    if ((config.numberOfHeats || 0) < 2) {
                      updateConfig("numberOfHeats", 2);
                    }
                  }}
                />
              </View>
            )}
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

        {/* Paso Settings (Only Latin) */}
        {config.category === "Latin" && (
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

        {/* Dances Selector */}
        <View style={styles.section}>
          <AppText
            variant="caption"
            weight="600"
            color={currentTheme.textSecondary}
            style={styles.sectionLabel}
          >
            Danses
          </AppText>
          <View style={styles.dancesGrid}>
            {DANCES[config.category].map((dance) => {
              const isActive = config.selectedDances.includes(dance);
              return (
                <TouchableOpacity
                  testID={`performance-setup-dance-${dance
                    .replace(/\s+/g, "-")
                    .toLowerCase()}`}
                  accessibilityLabel={`Toggle dance ${dance}`}
                  accessibilityHint="Active ou désactive cette danse pour la compétition"
                  key={dance}
                  onPress={() => toggleDance(dance)}
                  style={[
                    styles.danceChip,
                    isActive
                      ? {
                          borderColor: currentTheme.primary,
                          backgroundColor: currentTheme.primary,
                        }
                      : {
                          borderColor: currentTheme.border,
                        },
                  ]}
                >
                  <AppText
                    variant="caption"
                    weight="600"
                    color={isActive ? "#FFF" : currentTheme.text}
                  >
                    {dance}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.footer}>
          <AppButton
            title="DÉMARRER"
            onPress={() => {
              handleStart().catch(() => {});
            }}
            variant="primary"
            textStyle={styles.startButtonText}
            testID="performance-setup-start-button"
            accessibilityLabel="Démarrer la compétition"
            accessibilityHint="Lance la session avec les paramètres configurés"
          />
        </View>
      </ScrollView>

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
  dancesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  danceChip: {
    marginBottom: 8,
    borderRadius: 30,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
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
  startButtonText: {
    letterSpacing: 1,
    fontWeight: "bold",
  },
});
