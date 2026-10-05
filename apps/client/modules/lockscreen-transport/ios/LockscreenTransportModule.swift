import ExpoModulesCore
import MediaPlayer

/**
 * Lock-screen ⏮ / ⏭ buttons.
 *
 * expo-audio's MediaController wires play/pause/toggle/scrub on
 * MPRemoteCommandCenter but never touches nextTrackCommand /
 * previousTrackCommand (not even for its native playlist). The command center
 * is a process-wide singleton, so this module registers those two commands
 * alongside expo-audio's — no patch, no conflict (expo-audio's
 * enable/disable/removeTarget cycles only affect the commands it registered).
 *
 * Presses are forwarded to JS as events; TrackPlayerWrapper owns the queue
 * (tempo lock / per-track BPM / shuffle live there) and decides what
 * "next"/"previous" mean.
 */
public class LockscreenTransportModule: Module {
  private var nextTarget: Any?
  private var previousTarget: Any?

  public func definition() -> ModuleDefinition {
    Name("LockscreenTransport")

    Events("onRemoteNext", "onRemotePrevious")

    Function("setEnabled") { (enabled: Bool) in
      DispatchQueue.main.async { [weak self] in
        self?.setCommandsEnabled(enabled)
      }
    }

    OnDestroy {
      DispatchQueue.main.async { [weak self] in
        self?.setCommandsEnabled(false)
      }
    }
  }

  private func setCommandsEnabled(_ enabled: Bool) {
    let center = MPRemoteCommandCenter.shared()

    if enabled {
      // Idempotent: keep existing targets, just (re-)enable the buttons.
      if nextTarget == nil {
        nextTarget = center.nextTrackCommand.addTarget { [weak self] _ in
          self?.sendEvent("onRemoteNext", [:])
          return .success
        }
      }
      if previousTarget == nil {
        previousTarget = center.previousTrackCommand.addTarget { [weak self] _ in
          self?.sendEvent("onRemotePrevious", [:])
          return .success
        }
      }
      center.nextTrackCommand.isEnabled = true
      center.previousTrackCommand.isEnabled = true
    } else {
      if let target = nextTarget {
        center.nextTrackCommand.removeTarget(target)
        nextTarget = nil
      }
      if let target = previousTarget {
        center.previousTrackCommand.removeTarget(target)
        previousTarget = nil
      }
      center.nextTrackCommand.isEnabled = false
      center.previousTrackCommand.isEnabled = false
    }
  }
}
