import { create } from "zustand";
import {
  NotificationApi,
  type NotificationPreference,
} from "../services/api/notification-api";
import { createLogger } from "../utils/logger";

const logger = createLogger("notificationPreferences.store");

/**
 * Préférences de notification par type (#37).
 *
 * Le catalogue est piloté par le serveur : le client ne connaît aucun type et
 * se contente d'afficher ce que l'API renvoie. Les types ajoutés plus tard
 * (#39 : paiement, signalement, modération) deviennent donc réglables sans
 * livrer de nouvelle version du client — ce qui compte avec la latence de
 * l'App Store.
 */
interface NotificationPreferencesState {
  preferences: NotificationPreference[];
  loading: boolean;
  /** Types dont la bascule est en vol, pour désactiver l'interrupteur concerné. */
  pending: string[];
  error: string | null;

  load: () => Promise<void>;
  setPreference: (type: string, enabled: boolean) => Promise<void>;
  reset: () => void;
}

const initial = {
  preferences: [] as NotificationPreference[],
  loading: false,
  pending: [] as string[],
  error: null as string | null,
};

export const useNotificationPreferencesStore =
  create<NotificationPreferencesState>((set, get) => ({
    ...initial,

    load: async () => {
      set({ loading: true, error: null });
      try {
        const preferences = await NotificationApi.getPreferences();
        set({ preferences, loading: false });
      } catch (error) {
        logger.error("Load failed", error);
        set({
          loading: false,
          error: "Impossible de charger vos préférences de notification.",
        });
      }
    },

    setPreference: async (type, enabled) => {
      const previous = get().preferences;
      // Bascule optimiste : un interrupteur qui attend l'aller-retour réseau
      // paraît cassé, surtout sur un backend qui peut être en démarrage à froid.
      set({
        preferences: previous.map((p) =>
          p.type === type ? { ...p, enabled } : p,
        ),
        pending: [...get().pending, type],
        error: null,
      });

      try {
        await NotificationApi.updatePreference(type, enabled);
      } catch (error) {
        logger.error("Update failed", error);
        // Rollback : on restaure l'état d'avant plutôt que d'inverser, pour ne
        // pas écraser une autre bascule qui aurait abouti entre-temps.
        set((s) => ({
          preferences: s.preferences.map((p) => {
            const before = previous.find((q) => q.type === p.type);
            return p.type === type && before
              ? { ...p, enabled: before.enabled }
              : p;
          }),
          error: "La préférence n'a pas pu être enregistrée.",
        }));
      } finally {
        set((s) => ({ pending: s.pending.filter((t) => t !== type) }));
      }
    },

    reset: () => set({ ...initial }),
  }));
