import { ImageSourcePropType } from "react-native";

export interface TrackData {
  id: string;
  url: string | number; // require() (number) or string
  title: string;
  artist: string;
  artwork?: string;
  baseBpm: number;
  playlist?: string;
  style?: string;
  /** Modération admin — indique que le titre est masqué (affiche un indicateur
   *  côté admin ; les non-admins reçoivent déjà un libellé neutre du backend). */
  titleMasked?: boolean;
  /** Copie locale présente (favori téléchargé ou import) → jouable hors-ligne (#416). */
  isDownloaded?: boolean;
  /** Paso doble : timecodes (secondes) des appels/coups affichés sur le lecteur (#paso-clashes). */
  clashTimecodes?: number[];
}

export enum PlayerRepeatMode {
  Off = "off",
  Track = "track",
  Queue = "queue",
}

export enum State {
  None = "none",
  Ready = "ready",
  Playing = "playing",
  Paused = "paused",
  Stopped = "stopped",
  Buffering = "buffering",
  Connecting = "connecting",
}

export enum Capability {
  Play = "CAPABILITY_PLAY",
  PlayFromId = "CAPABILITY_PLAY_FROM_ID",
  PlayFromSearch = "CAPABILITY_PLAY_FROM_SEARCH",
  Pause = "CAPABILITY_PAUSE",
  Stop = "CAPABILITY_STOP",
  SeekTo = "CAPABILITY_SEEK_TO",
  Skip = "CAPABILITY_SKIP",
  SkipToNext = "CAPABILITY_SKIP_TO_NEXT",
  SkipToPrevious = "CAPABILITY_SKIP_TO_PREVIOUS",
  JumpForward = "CAPABILITY_JUMP_FORWARD",
  JumpBackward = "CAPABILITY_JUMP_BACKWARD",
  SetRating = "CAPABILITY_SET_RATING",
  Like = "CAPABILITY_LIKE",
  Dislike = "CAPABILITY_DISLIKE",
  Bookmark = "CAPABILITY_BOOKMARK",
}

export enum Event {
  PlayerError = "player-error",
  PlaybackState = "playback-state",
  PlaybackError = "playback-error",
  PlaybackQueueEnded = "playback-queue-ended",
  PlaybackTrackChanged = "playback-track-changed",
  PlaybackActiveTrackChanged = "playback-active-track-changed",
  PlaybackMetadataReceived = "playback-metadata-received",
  PlaybackPlayWhenReadyChanged = "playback-play-when-ready-changed",
  PlaybackProgressUpdated = "playback-progress-updated",
  RemotePlay = "remote-play",
  RemotePause = "remote-pause",
  RemoteStop = "remote-stop",
  RemoteNext = "remote-next",
  RemotePrevious = "remote-previous",
  RemoteJumpForward = "remote-jump-forward",
  RemoteJumpBackward = "remote-jump-backward",
  RemoteSeek = "remote-seek",
  RemoteSetRating = "remote-set-rating",
  RemoteDuck = "remote-duck",
  RemoteLike = "remote-like",
  RemoteDislike = "remote-dislike",
  RemoteBookmark = "remote-bookmark",
}

export enum RepeatMode {
  Off = 0,
  Track = 1,
  Queue = 2,
}

export enum PitchAlgorithm {
  Linear = "PITCH_ALGORITHM_LINEAR",
  Music = "PITCH_ALGORITHM_MUSIC",
  Voice = "PITCH_ALGORITHM_VOICE",
}

export enum RatingType {
  Heart = "RATING_HEART",
  ThumbsUpDown = "RATING_THUMBS_UP_DOWN",
  ThreeStars = "RATING_3_STARS",
  FourStars = "RATING_4_STARS",
  FiveStars = "RATING_5_STARS",
  Percentage = "RATING_PERCENTAGE",
}

export interface TrackMetadata {
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
  description?: string;
  genre?: string;
  date?: string;
  rating?: number | boolean;
  artwork?: string | ImageSourcePropType;
}

export interface Track extends TrackMetadata {
  id: string; // ID is mandatory
  url: string;
  type?: string;
  userAgent?: string;
  contentType?: string;
  pitchAlgorithm?: PitchAlgorithm;
  headers?: { [key: string]: string };
  [key: string]: unknown; // Allow custom data but prefer explicit extension
}

export interface PlayerOptions {
  minBuffer?: number;
  maxBuffer?: number;
  playBuffer?: number;
  backBuffer?: number;
  maxCacheSize?: number;
  iosCategory?:
    | "playback"
    | "playAndRecord"
    | "multiRoute"
    | "ambient"
    | "soloAmbient"
    | "record";
  iosCategoryMode?:
    | "default"
    | "gameChat"
    | "measurement"
    | "moviePlayback"
    | "spokenAudio"
    | "videoChat"
    | "videoRecording"
    | "voiceChat"
    | "voicePrompt";
  iosCategoryOptions?: (
    | "mixWithOthers"
    | "duckOthers"
    | "interruptSpokenAudioAndMixWithOthers"
    | "allowBluetooth"
    | "allowBluetoothA2DP"
    | "allowAirPlay"
    | "defaultToSpeaker"
  )[];
  waitForBuffer?: boolean;
  capabilities?: Capability[];
  compactCapabilities?: Capability[];
  notificationCapabilities?: Capability[];
}

export interface PlaybackState {
  state: State;
  error?: string;
}

export interface PlaybackProgress {
  position: number;
  duration: number;
  buffered: number;
}

export interface PlaybackTrackChangedEvent {
  track: number | null;
  position: number;
  nextTrack: number | null;
}

export interface PlaybackErrorEvent {
  code: string;
  message: string;
}

export interface RemoteSeekEvent {
  position: number;
}

export enum AppKilledPlaybackBehavior {
  ContinuePlayback = "continue-playback",
  PausePlayback = "pause-playback",
  StopPlaybackAndRemoveNotification = "stop-playback-and-remove-notification",
}
