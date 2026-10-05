import axios from "axios";
import { Platform } from "react-native";
import { API_URL } from "../../../config";
import { createLogger } from "../../../utils/logger";
import { AuthService } from "../../auth/services/AuthService";

const logger = createLogger("ReportService");

export const ReportService = {
  sendReport: async (data: {
    type: "BUG" | "FEATURE";
    title: string;
    description: string;
    module?: string;
    severity?: "LOW" | "MEDIUM" | "HIGH";
    appVersion?: string;
    steps?: string;
    stackTrace?: string;
    image?: { uri: string; type: string; name: string };
  }) => {
    try {
      const deviceInfo = `${Platform.OS} ${Platform.Version}`;

      // Get User Context
      const authConfig = await AuthService.getAuthConfig();
      const userId =
        authConfig.isLoggedIn && authConfig.username
          ? authConfig.username
          : "Anonymous";

      const formData = new FormData();
      formData.append("userId", userId);
      formData.append("deviceInfo", deviceInfo);
      formData.append("type", data.type);
      formData.append("title", data.title);
      formData.append("description", data.description);
      if (data.module) formData.append("module", data.module);
      if (data.severity) formData.append("severity", data.severity);
      if (data.appVersion) formData.append("appVersion", data.appVersion);
      if (data.steps) formData.append("steps", data.steps);
      if (data.stackTrace) formData.append("stackTrace", data.stackTrace);

      // Attach Black Box Logs
      const logs = logger.getLogs();
      formData.append("logs", logs);

      if (data.image) {
        formData.append("image", {
          uri: data.image.uri,
          type: data.image.type,
          name: data.image.name,
        });
      }

      await axios.post(`${API_URL}/reports`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      logger.info("Report sent successfully");
    } catch (error) {
      logger.error("Failed to send report", error);
    }
  },
};
