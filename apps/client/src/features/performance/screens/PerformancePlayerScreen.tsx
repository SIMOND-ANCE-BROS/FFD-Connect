import { useNavigation } from "@react-navigation/native";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react-native";
import React, { useCallback, useEffect, useRef } from "react";
import {
  Alert,
  BackHandler,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { PlaylistItem } from "../context/PerformanceContext";
import { usePerformanceEngine } from "../hooks/usePerformanceEngine";
import { usePerformanceStore } from "../../../stores/performance.store";
import {
  danceLabel,
  describeGroup,
  describeItem,
} from "../utils/competitionProgram";

export const PerformancePlayerScreen = () => {
  const { theme: currentTheme, isDark } = useTheme();
  const {
    status,
    playlist,
    currentDanceIndex,
    timeRemaining,
    activePhase,
    isAnnouncing,
    togglePlayPause,
    stopPerformance,
    nextStep,
    previousStep,
  } = usePerformanceEngine();
  const navigation = useNavigation<{ goBack: () => void }>();

  // Handle exit with confirmation
  const handleExit = useCallback(() => {
    Alert.alert("Arrêter ?", "Voulez-vous arrêter la compétition ?", [
      { text: "Non", onPress: () => null, style: "cancel" },
      {
        text: "Oui",
        onPress: () => {
          stopPerformance();
          navigation.goBack();
        },
      },
    ]);
  }, [stopPerformance, navigation]);

  // Leaving this screen by ANY path (swipe, deep link, reset…) stops the
  // competition: the engine is a module singleton and would otherwise keep
  // playing with no screen to control it. Exit/finish already stop it.
  const stopRef = useRef(stopPerformance);
  stopRef.current = stopPerformance;
  useEffect(
    () => () => {
      const current = usePerformanceStore.getState().status;
      if (current !== "idle" && current !== "finished") {
        stopRef.current();
      }
    },
    [],
  );

  // Prevent back button
  useEffect(() => {
    const backAction = () => {
      handleExit();
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction,
    );
    return () => backHandler.remove();
  }, [handleExit]);

  // Auto-exit if finished
  useEffect(() => {
    if (status === "finished") {
      navigation.goBack();
    }
  }, [status, navigation]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // currentDanceIndex vaut -1 pendant la pause initiale (avant la 1re danse) :
  // exiger >= 0 sinon playlist[-1] est undefined et l'accès à heatIndex crashe.
  const hasCurrentItem =
    currentDanceIndex >= 0 && currentDanceIndex < playlist.length;
  const currentItem = playlist[currentDanceIndex] as PlaylistItem | undefined;
  const isBreak = activePhase === "break";
  const nextItem = playlist[currentDanceIndex + 1] as PlaylistItem | undefined;
  const isPreparation =
    !hasCurrentItem && status !== "loading" && status !== "finished";
  // Skips are refused while the MC speaks (the engine ignores them anyway).
  const isRunning =
    status === "playing" || status === "break" || status === "paused";
  const canSkipForward = isRunning && !isAnnouncing;
  const canSkipBack = canSkipForward && hasCurrentItem;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
    >
      <StatusBar
        barStyle={currentTheme.statusBarStyle}
        backgroundColor={currentTheme.background}
      />

      {/* Header Info */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleExit}
          style={[styles.backButton, { backgroundColor: currentTheme.surface }]}
          testID="performance-player-exit-button"
          accessibilityLabel="Arrêter la performance"
          accessibilityHint="Arrête la session de performance actuelle"
        >
          <X color={currentTheme.text} size={24} />
        </TouchableOpacity>

        <View style={styles.headerChips}>
          <View
            style={[
              styles.headerChip,
              { backgroundColor: currentTheme.surface },
            ]}
          >
            <AppText variant="caption" weight="bold" color={currentTheme.text}>
              {hasCurrentItem && currentItem
                ? currentItem.roundType === "Final" &&
                  currentItem.totalGroups <= 1
                  ? "FINALE"
                  : describeGroup(currentItem).toUpperCase()
                : "PRÉPARATION"}
            </AppText>
          </View>
          {hasCurrentItem && currentItem && (
            <View
              style={[
                styles.headerChip,
                { backgroundColor: currentTheme.surface },
              ]}
            >
              <AppText
                variant="caption"
                weight="bold"
                color={currentTheme.text}
              >
                {`TOUR ${currentItem.roundIndex}/${currentItem.totalRounds}`}
              </AppText>
            </View>
          )}
        </View>
      </View>

      {hasCurrentItem && currentItem && (
        <AppText
          variant="body"
          weight="600"
          color={currentTheme.textSecondary}
          style={styles.contextLine}
          testID="performance-player-context"
        >
          {describeItem(currentItem)}
        </AppText>
      )}

      {/* Main Visual */}
      <View style={styles.mainContent}>
        {isPreparation ? (
          <View
            style={[
              styles.phaseContainer,
              isDark ? styles.bgDarkPrepare : styles.bgLightPrepare,
            ]}
          >
            <AppText variant="h2" weight="bold" style={styles.preparationText}>
              PRÉPARATION
            </AppText>
            <AppText
              variant="h1"
              weight="bold"
              color={currentTheme.text}
              style={styles.displayText}
            >
              {formatTime(timeRemaining)}
            </AppText>
            <AppText
              variant="caption"
              color={currentTheme.textSecondary}
              style={styles.preparationSubtext}
            >
              {isAnnouncing
                ? "Annonce en cours…"
                : nextItem
                  ? `Premier : ${describeItem(nextItem)}`
                  : "Préparez-vous"}
            </AppText>
          </View>
        ) : isBreak ? (
          <View
            style={[
              styles.phaseContainer,
              isDark ? styles.bgDarkPause : styles.bgLightPause,
            ]}
          >
            <AppText variant="h2" weight="bold" style={styles.pauseText}>
              PAUSE
            </AppText>
            <AppText
              variant="h1"
              weight="bold"
              color={currentTheme.text}
              style={styles.displayText}
            >
              {formatTime(timeRemaining)}
            </AppText>
            <AppText
              variant="caption"
              color={currentTheme.textSecondary}
              style={styles.pauseSubtext}
            >
              {isAnnouncing
                ? "Annonce en cours…"
                : `Suivant : ${nextItem ? describeItem(nextItem) : "Fin"}`}
            </AppText>
          </View>
        ) : (
          <View
            style={[
              styles.phaseContainer,
              isDark ? styles.bgDarkInProgress : styles.bgLightInProgress,
            ]}
          >
            <AppText variant="h2" weight="bold" style={styles.inProgressText}>
              EN COURS
            </AppText>
            <AppText
              variant="h3"
              weight="600"
              color={currentTheme.text}
              style={styles.inProgressSubtext}
            >
              {currentItem ? danceLabel(currentItem.style) : ""}
            </AppText>
            <AppText
              variant="h1"
              weight="bold"
              color={currentTheme.text}
              style={styles.displayText}
            >
              {formatTime(timeRemaining)}
            </AppText>
          </View>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={[
            styles.skipBtn,
            { backgroundColor: currentTheme.surface },
            !canSkipBack && styles.disabled,
          ]}
          onPress={previousStep}
          disabled={!canSkipBack}
          testID="performance-player-previous-button"
          accessibilityRole="button"
          accessibilityLabel="Recommencer la danse"
          accessibilityHint="Relance la danse depuis le début ; deux appuis rapides reviennent à la danse précédente"
          accessibilityState={{ disabled: !canSkipBack }}
        >
          <SkipBack color={currentTheme.text} size={28} />
        </TouchableOpacity>

        {/* Main Play/Pause */}
        <TouchableOpacity
          style={[styles.playBtn, { backgroundColor: currentTheme.primary }]}
          onPress={togglePlayPause}
          testID="performance-player-play-pause-button"
          accessibilityLabel={
            status === "playing" ? "Pause performance" : "Play performance"
          }
          accessibilityHint="Met en pause ou reprend la performance"
        >
          {status === "playing" || status === "break" ? (
            <Pause
              color="#FFF"
              size={40}
              fill="#FFF"
              style={styles.playIconPause}
            />
          ) : (
            <Play
              color="#FFF"
              size={40}
              fill="#FFF"
              style={styles.playIconPlay}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.skipBtn,
            { backgroundColor: currentTheme.surface },
            !canSkipForward && styles.disabled,
          ]}
          onPress={nextStep}
          disabled={!canSkipForward}
          testID="performance-player-next-button"
          accessibilityRole="button"
          accessibilityLabel="Étape suivante"
          accessibilityHint="Termine la danse et lance la pause (la danse suivante y est annoncée), ou termine la pause et lance la danse suivante"
          accessibilityState={{ disabled: !canSkipForward }}
        >
          <SkipForward color={currentTheme.text} size={28} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  contextLine: {
    textAlign: "center",
    paddingHorizontal: 20,
  },
  headerChips: {
    flexDirection: "row",
    gap: 10,
  },
  headerChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  mainContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  phaseContainer: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 200, // Circle
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    padding: 20,
  },
  controlsContainer: {
    paddingBottom: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
    height: 150, // Fixed height for controls area
  },
  skipBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  disabled: {
    opacity: 0.4,
  },
  playBtn: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    marginBottom: 20,
  },
  preparationText: {
    color: "#2196F3",
    letterSpacing: 2,
    marginBottom: 10,
  },
  preparationSubtext: {
    marginTop: 10,
  },
  pauseText: {
    color: "#FFC107",
    letterSpacing: 2,
    marginBottom: 10,
  },
  pauseSubtext: {
    marginTop: 10,
  },
  inProgressText: {
    color: "#4CAF50",
    letterSpacing: 2,
    marginBottom: 10,
  },
  inProgressSubtext: {
    marginBottom: 20,
  },
  displayText: {
    fontSize: 72,
    lineHeight: 80,
  },
  playIconPlay: {
    marginLeft: 4,
  },
  playIconPause: {},
  bgDarkPrepare: {
    backgroundColor: "rgba(33,150,243,0.1)",
    borderColor: "#2196F3",
  },
  bgLightPrepare: {
    backgroundColor: "#E3F2FD",
    borderColor: "#2196F3",
  },
  bgDarkPause: {
    backgroundColor: "rgba(255,193,7,0.1)",
    borderColor: "#FFC107",
  },
  bgLightPause: {
    backgroundColor: "#FFF3E0",
    borderColor: "#FFC107",
  },
  bgDarkInProgress: {
    backgroundColor: "rgba(76,175,80,0.1)",
    borderColor: "#4CAF50",
  },
  bgLightInProgress: {
    backgroundColor: "#E8F5E9",
    borderColor: "#4CAF50",
  },
});
