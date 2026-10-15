import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { offlineCheckinVerdict } from "../../license/components/OfflineCheckinOverlay";
import {
  checkInOffline,
  refreshEntryQrKeys,
} from "../../license/services/offlineCheckin";
import { createLogger } from "../../../utils/logger";
import {
  CheckinResponse,
  CheckinService,
} from "../../license/services/CheckinService";
import { formatDiscipline } from "../../../utils/discipline";

const logger = createLogger("useVolunteerCheckinLogic");

export const useVolunteerCheckinLogic = (
  competitionId: string,
  token: string,
) => {
  const [isScanning, setIsScanning] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const [lastCheckin, setLastCheckin] = useState<CheckinResponse | null>(null);

  // Public keys for offline verification (#24), cached for the venue.
  useEffect(() => {
    refreshEntryQrKeys().catch(() => {});
  }, []);

  const handleBarCodeScanned = useCallback(
    async (qrData: string) => {
      if (isValidating) return;

      setIsValidating(true);
      setIsScanning(false);

      try {
        const response = await CheckinService.checkInAsVolunteer(
          competitionId,
          token,
          qrData,
        );
        setLastCheckin(response);
        Alert.alert(
          "Check-in réussi",
          `Participant: ${response.user.firstName} ${response.user.lastName}\n` +
            response.registrations
              .map((r) => `• ${formatDiscipline(r.event)}: ${r.status}`)
              .join("\n"),
        );
      } catch (error) {
        logger.error("Volunteer check-in error", error);
        // No answer at all (no network at the venue): verify the rotating QR
        // offline and queue the check-in for the next reconnect (#24).
        if (axios.isAxiosError(error) && !error.response) {
          const offline = await checkInOffline({
            qrData,
            endpoint: "POST /competitions/checkin/volunteer",
            payload: { competitionId, token },
            competitionId,
          });
          const verdict = offlineCheckinVerdict(offline, "");
          Alert.alert(
            verdict.title,
            offline.holderName
              ? `${offline.holderName}\n\n${verdict.message}`
              : verdict.message,
          );
          return;
        }
        const errorWithResponse = error as {
          response?: { data?: { message?: string } };
        };
        const message =
          errorWithResponse.response?.data?.message ??
          "Une erreur est survenue lors du check-in";
        Alert.alert("Erreur", message);
      } finally {
        setIsValidating(false);
      }
    },
    [competitionId, token, isValidating],
  );

  return {
    state: {
      isScanning,
      isValidating,
      lastCheckin,
    },
    actions: {
      setIsScanning,
      handleBarCodeScanned,
      reset: () => {
        setLastCheckin(null);
        setIsScanning(true);
      },
    },
  };
};
