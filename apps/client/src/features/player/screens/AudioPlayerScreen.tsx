import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ChevronDown, ListMusic, SlidersHorizontal } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  View,
} from "react-native";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { audioPlayerStyles as styles } from "../components/audio-player.styles";
import { PasoClashEditorModal } from "../components/PasoClashEditorModal";
import { PlayerArtwork } from "../components/PlayerArtwork";
import { PlayerBpmControls } from "../components/PlayerBpmControls";
import { PlayerControls } from "../components/PlayerControls";
import { PlayerProgress } from "../components/PlayerProgress";
import { PlayerQueueModal } from "../components/PlayerQueueModal";
import { PlayerTrackInfo } from "../components/PlayerTrackInfo";
import { useAudioPlayerLogic } from "../hooks/useAudioPlayerLogic";
import { isPasoDoble } from "../utils/pasoClashes";
import { usePlayerStore } from "../../../stores/player.store";
import { useAuthStore } from "../../../stores/auth.store";

type AudioPlayerScreenProps = NativeStackScreenProps<
  RootStackParamList,
  "AudioPlayer"
>;

export const AudioPlayerScreen = ({ navigation }: AudioPlayerScreenProps) => {
  const { theme: currentTheme, isDark } = useTheme();
  const { state, actions } = useAudioPlayerLogic();
  const { role } = useAuthStore();
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const [clashEditorVisible, setClashEditorVisible] = useState(false);
  const canEditClashes =
    role === "ADMIN" && isPasoDoble(state.currentTrack.style);

  if (!state.isPlayerReady || state.isLoading) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          styles.backgroundFill,
          { backgroundColor: currentTheme.background },
        ]}
      >
        <ActivityIndicator
          size="large"
          color={currentTheme.primary}
          testID="audio-player-loading-indicator"
        />
        <AppText
          style={styles.loadingText}
          accessibilityLabel="Chargement du lecteur audio"
          accessibilityHint="Patientez pendant le chargement"
        >
          Chargement du lecteur...
        </AppText>
      </View>
    );
  }

  if (state.errorMessage) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          styles.padding20,
          { backgroundColor: currentTheme.background },
        ]}
      >
        <AppText
          variant="h3"
          color="#F44336"
          style={styles.errorTitle}
          align="center"
        >
          Erreur
        </AppText>
        <AppText align="center" style={styles.marginBottom20}>
          {state.errorMessage}
        </AppText>
        <TouchableOpacity
          accessibilityRole="button"
          testID="audio-player-retry-button"
          onPress={actions.togglePlayback}
          style={[
            styles.retryButton,
            styles.surfaceBackground,
            { backgroundColor: currentTheme.surface },
          ]}
        >
          <AppText color={currentTheme.primary} weight="bold">
            Réessayer
          </AppText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
    >
      <StatusBar
        barStyle={currentTheme.statusBarStyle}
        backgroundColor={currentTheme.background}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          testID="audio-player-back-button"
          onPress={() => navigation.goBack()}
          style={styles.headerButton}
        >
          <ChevronDown color={currentTheme.text} size={32} />
        </TouchableOpacity>

        <View style={styles.playlistNameContainer}>
          <AppText
            variant="caption"
            weight="600"
            style={styles.playlistLabel}
            color={currentTheme.text}
          >
            {state.currentTrack.playlist ?? "Titres likés"}
          </AppText>
        </View>

        <TouchableOpacity
          testID="audio-player-queue-button"
          accessibilityLabel="Ouvrir la file d'attente"
          accessibilityHint="Affiche la liste des morceaux à suivre"
          style={styles.headerButton}
          onPress={actions.openQueue}
        >
          <ListMusic color={currentTheme.text} size={24} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <PlayerArtwork
          currentTheme={currentTheme}
          isDark={isDark}
          artwork={state.currentTrack.artwork}
          isBpmVisible={state.isBpmVisible}
        />

        <PlayerTrackInfo
          currentTheme={currentTheme}
          isDark={isDark}
          currentTrack={state.currentTrack}
          isLiked={state.isLiked}
          isBpmVisible={state.isBpmVisible}
          toggleLike={actions.toggleLike}
          setIsBpmVisible={actions.setIsBpmVisible}
        />

        {state.isBpmVisible && (
          <PlayerBpmControls
            currentTheme={currentTheme}
            isDark={isDark}
            bpm={state.bpm}
            bpmDiff={state.bpmDiff}
            minMpm={state.minMpm}
            maxMpm={state.maxMpm}
            changeBpm={actions.changeBpm}
            resetBpm={actions.resetBpm}
            locked={state.isTempoLocked}
            onToggleLock={actions.toggleTempoLock}
          />
        )}

        <PlayerProgress
          currentTheme={currentTheme}
          isDark={isDark}
          progress={state.progress}
          seekTo={actions.seekTo}
          style={state.currentTrack.style}
          clashTimecodes={state.currentTrack.clashTimecodes}
        />

        {canEditClashes && (
          <TouchableOpacity
            onPress={() => setClashEditorVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Éditer les appels du paso doble"
            accessibilityHint="Ouvre l'éditeur des timecodes des appels (admin)"
            testID="paso-edit-clashes-button"
            style={styles.clashEditButton}
          >
            <SlidersHorizontal size={16} color={currentTheme.textSecondary} />
            <AppText variant="caption" color={currentTheme.textSecondary}>
              Éditer les appels
            </AppText>
          </TouchableOpacity>
        )}

        <PlayerControls
          currentTheme={currentTheme}
          isShuffle={state.isShuffle}
          isPlaying={state.isPlaying}
          repeatMode={state.repeatMode}
          toggleShuffle={actions.toggleShuffle}
          handlePrev={actions.handlePrev}
          handleNext={actions.handleNext}
          togglePlayback={actions.togglePlayback}
          toggleRepeat={actions.toggleRepeat}
        />
      </View>

      <PlayerQueueModal
        currentTheme={currentTheme}
        isDark={isDark}
        isQueueVisible={state.isQueueVisible}
        tracks={state.tracks}
        currentTrackId={state.currentTrack.id}
        closeQueue={actions.closeQueue}
        playQueueTrack={actions.playQueueTrack}
        removeQueueTrack={actions.removeQueueTrack}
      />

      {canEditClashes && (
        <PasoClashEditorModal
          visible={clashEditorVisible}
          trackId={state.currentTrack.id}
          style={state.currentTrack.style}
          clashTimecodes={state.currentTrack.clashTimecodes}
          position={state.progress.position}
          duration={state.progress.duration}
          isPlaying={state.isPlaying}
          onTogglePlay={actions.togglePlayback}
          onSeek={(s) => {
            actions.seekTo(s).catch(() => {});
          }}
          onClose={() => setClashEditorVisible(false)}
          onSaved={(clashes) => {
            // Rafraîchit les marqueurs du lecteur sans recharger.
            setCurrentTrack({ ...state.currentTrack, clashTimecodes: clashes });
          }}
        />
      )}
    </SafeAreaView>
  );
};
