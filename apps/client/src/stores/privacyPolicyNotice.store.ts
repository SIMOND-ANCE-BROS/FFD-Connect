import { create } from "zustand";
import { PrivacyPolicyApi } from "../services/api/privacy-policy-api";
import { createLogger } from "../utils/logger";

const logger = createLogger("privacyPolicyNotice.store");

/**
 * Notice « la politique de confidentialité a été mise à jour » (#734).
 *
 * The backend decides whether a version is pending for the signed-in account;
 * the notice disappears as soon as the user dismisses it (optimistic), and the
 * acknowledgement is sent in the background. If it fails, the notice comes
 * back at the next launch: better told twice than never.
 */
interface PrivacyPolicyNoticeState {
  /** Version to announce; null = nothing to show. */
  pendingVersion: string | null;
  check: () => Promise<void>;
  acknowledge: () => Promise<void>;
  reset: () => void;
}

export const usePrivacyPolicyNoticeStore = create<PrivacyPolicyNoticeState>(
  (set, get) => ({
    pendingVersion: null,

    check: async () => {
      set({ pendingVersion: await PrivacyPolicyApi.pendingVersion() });
    },

    acknowledge: async () => {
      const version = get().pendingVersion;
      if (!version) return;
      set({ pendingVersion: null });
      const saved = await PrivacyPolicyApi.acknowledge(version);
      if (!saved) {
        logger.warn("Acknowledgement not saved; the notice will come back");
      }
    },

    reset: () => set({ pendingVersion: null }),
  }),
);
