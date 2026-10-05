import { BACKEND_URL } from "../../config";

export const HealthApi = {
  async checkHealth(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(`${BACKEND_URL}`, {
        method: "GET",
        signal: controller.signal,
      });
      return response.ok || response.status === 404;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
