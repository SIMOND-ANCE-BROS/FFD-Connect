import TrackPlayer, {
  Capability,
  Event,
  RemoteSeekEvent,
} from "../../../utils/TrackPlayerWrapper";

export async function setupPlayer() {
  let isSetup = false;
  try {
    await TrackPlayer.getCurrentTrack();
    isSetup = true;
  } catch {
    await TrackPlayer.setupPlayer();
    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SeekTo,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
    });
    isSetup = true;
  }
  return isSetup;
}

export function setupService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play().catch(() => {});
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause().catch(() => {});
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.reset().catch(() => {});
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    TrackPlayer.skipToNext().catch(() => {});
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    TrackPlayer.skipToPrevious().catch(() => {});
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (event: RemoteSeekEvent) => {
    TrackPlayer.seekTo(event.position).catch(() => {});
  });
}

// Export par défaut pour react-native-track-player
export default setupService;
