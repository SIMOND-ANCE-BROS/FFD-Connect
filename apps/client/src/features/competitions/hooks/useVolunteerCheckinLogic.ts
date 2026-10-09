import { useCallback, useState } from "react";
import { Alert } from "react-native";
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
