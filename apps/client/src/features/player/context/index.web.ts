/**
 * Point d'entrée web : exporte PlayerContext.web.tsx (sans react-native-track-player)
 * Metro résout automatiquement index.web.ts quand platform=web
 */
export {
  ContextRepeatMode,
  PlayerProvider,
  usePlayer,
  type TrackData,
} from "./PlayerContext.web";
