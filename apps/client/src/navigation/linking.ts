import { LinkingOptions } from "@react-navigation/native";
import { RootStackParamList } from "./types";

/**
 * Deep linking configuration for the app.
 *
 * Supported URLs:
 * - ffdconnect://reset-password?token=xxx  (from password reset emails)
 * - https://app.ffd-connect.fr/reset-password?token=xxx  (universal link)
 * - ffdconnect://competition/xxx  (open competition detail)
 * - ffdconnect://volunteer-checkin?competitionId=xxx&token=xxx  (volunteer scan link)
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["ffdconnect://", "https://app.ffd-connect.fr"],
  config: {
    screens: {
      ResetPassword: "reset-password",
      CompetitionDetail: "competition/:competitionId",
      VolunteerCheckin: "volunteer-checkin",
      Login: "login",
      Main: "main",
    },
  },
};
