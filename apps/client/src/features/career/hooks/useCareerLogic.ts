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

  const load = useCallback(async () => {
    const config = await auth.getAuthConfig();
    if (!config.authToken || !config.isLoggedIn) {
      setPartnerships([]);
      setRegistrations([]);
      setResults([]);
      setLoading(false);
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
  }, [auth, withErrorHandling]);

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
