export const State = {
  None: 0,
  Ready: 1,
  Playing: 2,
  Paused: 3,
  Stopped: 4,
  Buffering: 5,
  Connecting: 6,
};
export const Capability = {};
export const AppKilledPlaybackBehavior = {};
export const PitchAlgorithm = {};
export const RatingType = {};
export const Event = {};
export const RepeatMode = {};

export const useProgress = () => ({ position: 0, duration: 0, buffered: 0 });
export const usePlaybackState = () => ({ state: State.None });
export const useTrackPlayerEvents = () => {};

export default {
  setupPlayer: () => {},
  destroy: () => {},
  add: () => {},
  remove: () => {},
  skip: () => {},
  skipToNext: () => {},
  skipToPrevious: () => {},
  reset: () => {},
  play: () => {},
  pause: () => {},
  stop: () => {},
  seekTo: () => {},
  setVolume: () => {},
  setRate: () => {},
  setRepeatMode: () => {},
  getVolume: () => 1,
  getRate: () => 1,
  getTrack: () => null,
  getQueue: () => [],
  getCurrentTrack: () => 0,
  getDuration: () => 0,
  getPosition: () => 0,
  getBufferedPosition: () => 0,
  getState: () => State.None,
  updateOptions: () => {},
  CAPABILITY_PLAY: "CAPABILITY_PLAY",
  CAPABILITY_PAUSE: "CAPABILITY_PAUSE",
  CAPABILITY_STOP: "CAPABILITY_STOP",
  CAPABILITY_SKIP_TO_NEXT: "CAPABILITY_SKIP_TO_NEXT",
  CAPABILITY_SKIP_TO_PREVIOUS: "CAPABILITY_SKIP_TO_PREVIOUS",
  CAPABILITY_SEEK_TO: "CAPABILITY_SEEK_TO",
};
