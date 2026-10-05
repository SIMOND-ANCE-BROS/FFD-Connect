import axios from "axios";
import {
  useCameraPermissions,
  type BarcodeScanningResult,
  type PermissionResponse,
} from "expo-camera";
import { useCallback, useEffect, useState } from "react";
import { analytics } from "../../../services/analytics";
import { createLogger } from "../../../utils/logger";
import { CheckinResponse, CheckinService } from "../services/CheckinService";

const logger = createLogger("useScannerLogic");

export interface ScannerState {
  hasPermission: boolean;
  /** iOS ne re-demande pas après un refus : false → il faut ouvrir Réglages. */
  canAskAgain: boolean;
  torch: "off" | "on";
  isActive: boolean;
  isLoading: boolean;
  result: CheckinResponse | null;
  error: string | null;
}

export interface ScannerActions {
  requestPermission: () => Promise<PermissionResponse>;
  toggleTorch: () => void;
  resetScan: () => void;
  handleBarcodeScanned: (result: BarcodeScanningResult) => void;
  simulateScan: (success: boolean) => void;
}

export const useScannerLogic = (initialCompetitionId?: string) => {
  const [permission, requestPermission] = useCameraPermissions();
  const hasPermission = permission?.granted === true;
  // Tant que la permission n'est pas chargée (null), on suppose qu'on peut
  // demander ; une fois refusée définitivement, canAskAgain passe à false.
  const canAskAgain = permission?.canAskAgain ?? true;

  // Local State
  const [competitionId, setCompetitionId] = useState<string | null>(
    initialCompetitionId ?? null,
  );
  const [isFetchingCompetition, setIsFetchingCompetition] =
    useState(!initialCompetitionId);

  const [torch, setTorch] = useState<"off" | "on">("off");
  const [isActive, setIsActive] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<CheckinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initial Permission Request — une seule fois, et seulement si iOS accepte
  // encore d'afficher le prompt (sinon requestPermission() se résout en silence
  // et l'utilisateur croit que le bouton ne fait rien).
  useEffect(() => {
    if (permission && !hasPermission && canAskAgain) {
      requestPermission().catch(() => {});
    }
  }, [permission, hasPermission, canAskAgain, requestPermission]);

  // Fetch Active Competition if needed
  useEffect(() => {
    if (!competitionId) {
      setIsFetchingCompetition(true);
      CheckinService.getActiveCompetition()
        .then((comp) => {
          if (comp) {
            logger.info("Found Active Competition:", comp.title);
            setCompetitionId(comp.id);
          } else {
            setError("Aucune compétition active aujourd'hui.");
          }
          setIsFetchingCompetition(false);
        })
        .catch(() => {
          setIsFetchingCompetition(false);
        });
    }
  }, [competitionId]);

  const handleBarcodeScanned = useCallback(
    async ({ data }: BarcodeScanningResult) => {
      if (!isActive || isLoading) return;
      if (!competitionId) {
        // If validation logic requires competition ID, we can't proceed.
        // But if we are still fetching, we wait. If failed, we show error.
        if (!isFetchingCompetition && !error)
          setError("Aucune compétition identifiée.");
        return;
      }

      if (!data) return;

      setIsActive(false);
      setIsLoading(true);
      setError(null);

      try {
        logger.debug("Processing Code:", data);
        const response = await CheckinService.checkIn(competitionId, data);
        setResult(response);
        const hasSuccess = response.registrations.some(
          (r) => r.status === "SUCCESS" || r.status === "ALREADY_CHECKED_IN",
        );
        if (hasSuccess) {
          analytics.logEvent("license_scan", { competition_id: competitionId });
        }
      } catch (err) {
        logger.error("Checkin Error:", err);
        // Surface le message MÉTIER du backend (« Utilisateur introuvable… »,
        // « Aucune inscription confirmée… ») plutôt que « Request failed with
        // status code 404 » d'axios.
        let message = "Une erreur est survenue lors du scan.";
        if (axios.isAxiosError(err)) {
          const data = err.response?.data as { message?: string } | undefined;
          message = data?.message ?? message;
        } else if (err instanceof Error) {
          message = err.message;
        }
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [isActive, isLoading, competitionId, isFetchingCompetition, error],
  );

  const resetScan = useCallback(() => {
    setResult(null);
    setError(null);
    setIsActive(true);
    setIsLoading(false);
  }, []);

  const toggleTorch = useCallback(() => {
    setTorch((prev) => (prev === "on" ? "off" : "on"));
  }, []);

  const simulateScan = useCallback((success: boolean) => {
    setIsActive(false);
    setIsLoading(true);
    setError(null);

    // Fake network delay
    const timer = setTimeout(() => {
      if (success) {
        setResult({
          user: { firstName: "Jean", lastName: "DUPONT" },
          registrations: [
            {
              event: "Latin Serie A",
              status: "SUCCESS",
              bibNumber: 42,
              partner: "Marie DUPONT",
            },
          ],
        });
      } else {
        setError("Utilisateur non inscrit ou droits non payés");
      }
      setIsLoading(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return {
    state: {
      hasPermission,
      canAskAgain,
      torch,
      isActive,
      isLoading,
      result,
      error,
    },
    actions: {
      requestPermission,
      toggleTorch,
      resetScan,
      simulateScan,
      handleBarcodeScanned,
    },
  };
};
