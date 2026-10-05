import { useCallback, useEffect, useState } from "react";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { useErrorHandler } from "../../../hooks/useErrorHandler";
import {
  BackendService,
  CareerPartnership,
  CareerRegistration,
  CareerResult,
} from "../../../services/BackendService";

export function useCareerUserLogic(userId: string | null) {
  const auth = useAuthRepository();
  const { withErrorHandling } = useErrorHandler();
  const [partnerships, setPartnerships] = useState<CareerPartnership[]>([]);
  const [registrations, setRegistrations] = useState<CareerRegistration[]>([]);
  const [results, setResults] = useState<CareerResult[]>([]);
  const [loading, setLoading] = useState(!!userId);

  const load = useCallback(async () => {
    if (!userId) {
      setPartnerships([]);
      setRegistrations([]);
      setResults([]);
      setLoading(false);
      return;
    }
    const config = await auth.getAuthConfig();
    if (!config.authToken || !config.isLoggedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    await withErrorHandling(
      async () => {
        const data = await BackendService.getUserCareer(
          config.authToken!,
          userId,
        );
        setPartnerships(data.partnerships);
        setRegistrations(data.registrations);
        setResults(data.results);
      },
      {
        userMessage: "Impossible de charger la carrière",
        showAlert: true,
        logError: true,
      },
    );
    setLoading(false);
  }, [auth, userId, withErrorHandling]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return {
    partnerships,
    registrations,
    results,
    loading,
    refresh: load,
  };
}
