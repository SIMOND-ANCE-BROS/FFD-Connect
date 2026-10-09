import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import { useIsOnline } from "../../../hooks/useIsOnline";
import { analytics } from "../../../services/analytics";
import {
  APPLE_WALLET_GENERIC_ERROR,
  AppleWalletLinkError,
  LicenseApi,
} from "../../../services/api/license-api";
import { createLogger } from "../../../utils/logger";
import type { LicenseUser } from "../components/LicenseCard";
import { computeLicenseExpiry } from "../utils/licenseExpiry";

const logger = createLogger("useAppleWalletPass");

export interface AppleWalletPassState {
  /** iOS, server able to issue the pass, license with a future end date. */
  visible: boolean;
  /** No network (live NetInfo, or license served from the offline snapshot). */
  offline: boolean;
  loading: boolean;
  /** User-facing French message of the last failure, if any. */
  error: string | null;
}

/**
 * Whether the "Add to Apple Wallet" button applies to this license (#163).
 * An unknown end date counts as not valid: the server would refuse the pass.
 */
export function canAddLicenseToAppleWallet(
  license: LicenseUser | null | undefined,
  platform: string = Platform.OS,
  now: Date = new Date(),
): boolean {
  if (platform !== "ios" || !license) return false;
  if (license.appleWalletAvailable !== true) return false;
  if (!license.validUntilRaw) return false;
  const expiry = computeLicenseExpiry(license.validUntilRaw, now);
  return expiry.days !== null && expiry.status !== "expired";
}

/**
 * "Add to Apple Wallet" flow (#163), JS only: the app asks the API for a
 * one-time download link, then opens it in Safari, which shows the system
 * Wallet sheet. Backend wake-up (scale-to-zero) is handled globally by
 * `backendWake`: no retry here.
 */
export function useAppleWalletPass(
  license: LicenseUser | null | undefined,
  options: { servedFromSnapshot: boolean },
): { state: AppleWalletPassState; addToWallet: () => Promise<void> } {
  const isOnline = useIsOnline();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const visible = canAddLicenseToAppleWallet(license);
  const offline = !isOnline || options.servedFromSnapshot;

  const addToWallet = useCallback(async () => {
    if (inFlight.current || offline) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const url = await LicenseApi.createAppleWalletPassUrl();
      await Linking.openURL(url);
      analytics.logEvent("license_wallet_add", {
        wallet: "apple",
        outcome: "opened",
      });
    } catch (err) {
      const status =
        err instanceof AppleWalletLinkError ? err.status : undefined;
      logger.warn("Apple Wallet pass link failed", undefined, { status });
      analytics.logEvent("license_wallet_add", {
        wallet: "apple",
        outcome: "error",
        status,
      });
      if (mounted.current) {
        setError(
          err instanceof AppleWalletLinkError
            ? err.message
            : APPLE_WALLET_GENERIC_ERROR,
        );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [offline]);

  return { state: { visible, offline, loading, error }, addToWallet };
}
