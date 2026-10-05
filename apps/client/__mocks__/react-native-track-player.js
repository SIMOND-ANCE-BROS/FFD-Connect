// __mocks__/react-native-track-player.js

export const Event = {
  PlaybackState: "playback-state",
  PlaybackError: "playback-error",
  PlaybackQueueEnded: "playback-queue-ended",
  PlaybackTrackChanged: "playback-track-changed",
  PlaybackMetadataReceived: "playback-metadata-received",
  RemotePlay: "remote-play",
  RemotePause: "remote-pause",
  RemoteStop: "remote-stop",
  RemoteNext: "remote-next",
  RemotePrevious: "remote-previous",
  RemoteSeek: "remote-seek",
  RemoteDuck: "remote-duck",
};

export const State = {
  None: "none",
  Ready: "ready",
  Playing: "playing",
  Paused: "paused",
  Stopped: "stopped",
  Buffering: "buffering",
  Connecting: "connecting",
};

export const Capability = {
  Play: "play",
  PlayFromId: "play-from-id",
  PlayFromSearch: "play-from-search",
  Pause: "pause",
  Stop: "stop",
  SeekTo: "seek-to",
  Skip: "skip",
  SkipToNext: "skip-to-next",
  SkipToPrevious: "skip-to-previous",
  JumpForward: "jump-forward",
  JumpBackward: "jump-backward",
  SetRating: "set-rating",
  Like: "like",
  Dislike: "dislike",
  Bookmark: "bookmark",
};

export const RatingType = {
  Heart: "heart",
  ThumbsUpDown: "thumbs-up-down",
  ThreeStars: "three-stars",
  FourStars: "four-stars",
  FiveStars: "five-stars",
  Percentage: "percentage",
};

export const PitchAlgorithm = {
  Linear: "linear",
  Music: "music",
  Voice: "voice",
};

export const RepeatMode = {
  Off: 0,
  Track: 1,
  Queue: 2,
};

export const AppKilledPlaybackBehavior = {
  ContinuePlayback: "continue-playback",
  PausePlayback: "pause-playback",
  StopPlaybackAndRemoveNotification: "stop-playback-and-remove-notification",
};

// Mock Methods
export const setupPlayer = jest.fn(() => Promise.resolve());
export const destroy = jest.fn(() => Promise.resolve());
export const updateOptions = jest.fn(() => Promise.resolve());
export const add = jest.fn(() => Promise.resolve());
export const remove = jest.fn(() => Promise.resolve());
export const skip = jest.fn(() => Promise.resolve());
export const skipToNext = jest.fn(() => Promise.resolve());
export const skipToPrevious = jest.fn(() => Promise.resolve());
export const reset = jest.fn(() => Promise.resolve());
export const play = jest.fn(() => Promise.resolve());
export const pause = jest.fn(() => Promise.resolve());
export const seekTo = jest.fn(() => Promise.resolve());
export const setVolume = jest.fn(() => Promise.resolve());
export const getVolume = jest.fn(() => Promise.resolve(1));
export const setRate = jest.fn(() => Promise.resolve());
export const getRate = jest.fn(() => Promise.resolve(1));
export const getTrack = jest.fn(() => Promise.resolve(null));
export const getQueue = jest.fn(() => Promise.resolve([]));
export const getCurrentTrack = jest.fn(() => Promise.resolve(null));
export const getDuration = jest.fn(() => Promise.resolve(0));
export const getPosition = jest.fn(() => Promise.resolve(0));
export const getBufferedPosition = jest.fn(() => Promise.resolve(0));
export const getState = jest.fn(() => Promise.resolve(State.None));
export const setRepeatMode = jest.fn(() => Promise.resolve());
export const getRepeatMode = jest.fn(() => Promise.resolve(RepeatMode.Off));

// Event Listeners
export const addEventListener = jest.fn(() => ({
  remove: jest.fn(),
}));

// Hooks
export const usePlaybackState = jest.fn(() => ({ state: State.None }));
export const useProgress = jest.fn(() => ({
  position: 0,
  duration: 0,
  buffered: 0,
}));
export const useTrackPlayerEvents = jest.fn();

const TrackPlayer = {
  setupPlayer,
  destroy,
  updateOptions,
  add,
  remove,
  skip,
  skipToNext,
  skipToPrevious,
  reset,
  play,
  pause,
  seekTo,
  setVolume,
  getVolume,
  setRate,
  getRate,
  getTrack,
  getQueue,
  getCurrentTrack,
  getDuration,
  getPosition,
  getBufferedPosition,
  getState,
  setRepeatMode,
  getRepeatMode,
  addEventListener,
  Event,
  State,
  Capability,
  RatingType,
  PitchAlgorithm,
  RepeatMode,
  AppKilledPlaybackBehavior,
  usePlaybackState,
  useProgress,
  useTrackPlayerEvents,
};

export default TrackPlayer;
