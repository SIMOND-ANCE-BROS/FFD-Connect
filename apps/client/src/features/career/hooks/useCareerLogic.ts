import { useCallback, useEffect, useState } from "react";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { useErrorHandler } from "../../../hooks/useErrorHandler";
import {
  BackendService,
  CareerPartnership,
  CareerRegistration,
  CareerResult,
} from "../../../services/BackendService";

export function useCareerLogic() {
  const auth = useAuthRepository();
  const { withErrorHandling } = useErrorHandler();
  const [partnerships, setPartnerships] = useState<CareerPartnership[]>([]);
  const [registrations, setRegistrations] = useState<CareerRegistration[]>([]);
  const [results, setResults] = useState<CareerResult[]>([]);
  const [loading, setLoading] = useState(true);
  // Pull-to-refresh only. Kept apart from `loading` so the RefreshControl
  // spinner never shows on top of the screen's own first-load loader (two
  // stacked spinners on the Career tab, beta feedback).
  const [refreshing, setRefreshing] = useState(false);
  // Flips once the first load settles (data, empty career or error). Later
  // loads (pull-to-refresh) never bring the full-screen loader back, even on
  // an empty career: the RefreshControl spinner is enough.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    const config = await auth.getAuthConfig();
    if (!config.authToken || !config.isLoggedIn) {
      setPartnerships([]);
      setRegistrations([]);
      setResults([]);
      setLoading(false);
      setHasLoadedOnce(true);
      return;
    }
    setLoading(true);
    await withErrorHandling(
      async () => {
        const data = await BackendService.getMyCareer(config.authToken!);
        setPartnerships(data.partnerships);
        setRegistrations(data.registrations);
        setResults(data.results);
      },
      {
        userMessage: "Impossible de charger la carrière",
        showAlert: false,
        logError: true,
      },
    );
    setLoading(false);
    setHasLoadedOnce(true);
  }, [auth, withErrorHandling]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return {
    partnerships,
    registrations,
    results,
    loading,
    /** Full-screen loader: only until the first load settles. */
    isFirstLoad: loading && !hasLoadedOnce,
    refreshing,
    refresh,
  };
}
