import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";

type LockscreenTransportEvents = {
  /** L'utilisateur a appuyé sur ⏭ (piste suivante) sur l'écran verrouillé. */
  onRemoteNext: () => void;
  /** L'utilisateur a appuyé sur ⏮ (piste précédente) sur l'écran verrouillé. */
  onRemotePrevious: () => void;
};

declare class LockscreenTransportModule extends NativeModule<LockscreenTransportEvents> {
  /** Affiche/masque les boutons ⏮ ⏭ sur l'écran verrouillé (Now Playing iOS). */
  setEnabled(enabled: boolean): void;
}

/**
 * Module natif iOS uniquement (voir ios/LockscreenTransportModule.swift).
 * `null` sur Android, web, Expo Go, jest et sur tout binaire buildé avant
 * l'ajout du module — les appelants doivent dégrader en silence.
 */
export default requireOptionalNativeModule<LockscreenTransportModule>(
  "LockscreenTransport",
);
