import * as FileSystem from "expo-file-system";
import {
  type FileSystemUploadType,
  readAsStringAsync as fsReadAsStringAsync,
} from "expo-file-system/legacy";
import { Platform } from "react-native";
import { BACKEND_URL } from "../../config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { httpGet, httpPost } from "../../utils/httpInterceptor";
import { createLogger } from "../../utils/logger";

const logger = createLogger("LicenseApi");

export type LicenseRenewalStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";
export type LicenseRenewalDocumentType =
  | "MEDICAL_CERTIFICATE"
  | "LICENSE_CERTIFICATE";

export interface LicenseRenewalDocument {
  id: string;
  requestId: string;
  type: LicenseRenewalDocumentType;
  filePath: string;
  ocrData?: {
    isApte?: boolean;
    date?: string;
    doctorName?: string;
    licenseNumber?: string;
    name?: string;
    expiryDate?: string;
    rawText?: string;
    [key: string]: unknown;
  };
  createdAt: string;
}

export interface LicenseRenewalRequest {
  id: string;
  userId: string;
  status: LicenseRenewalStatus;
  createdAt: string;
  updatedAt: string;
  documents: LicenseRenewalDocument[];
}

export const LicenseApi = {
  async getMyLicense<T = unknown>(token: string): Promise<T> {
    return httpGet(`${BACKEND_URL}/licenses/my`, {
      headers: { Authorization: `Bearer ${token}` },
      errorMessage: ERROR_MESSAGES.LOADING_FAILED,
      logErrors: true,
    });
  },

  async startRenewalRequest(token: string): Promise<LicenseRenewalRequest> {
    return httpPost<LicenseRenewalRequest>(
      `${BACKEND_URL}/licenses/renewal/start`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
        logErrors: true,
      },
    );
  },

  async getMyRenewalRequest(
    token: string,
  ): Promise<LicenseRenewalRequest | null> {
    const data = await httpGet<LicenseRenewalRequest | null>(
      `${BACKEND_URL}/licenses/renewal/my`,
      {
        headers: { Authorization: `Bearer ${token}` },
        errorMessage: ERROR_MESSAGES.LOADING_FAILED,
        logErrors: true,
      },
    );
    return data ?? null;
  },

  async uploadRenewalDocument(
    token: string,
    requestId: string,
    type: "MEDICAL_CERTIFICATE" | "LICENSE_CERTIFICATE",
    fileUri: string,
  ): Promise<LicenseRenewalRequest> {
    const uploadUrl = `${BACKEND_URL}/licenses/renewal/${requestId}/documents`;

    if (Platform.OS === "web") {
      const fileUriNorm = fileUri.replace("file://", "");
      const base64 = await fsReadAsStringAsync(fileUriNorm, {
        encoding: "base64",
      });
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray as unknown as string], {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      const formData = new FormData();
      formData.append("type", type);
      (
        formData as FormData & { append(n: string, v: Blob, f: string): void }
      ).append("document", blob, "document.jpg");

      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(err.message ?? `Upload failed ${response.status}`);
      }
      return response.json() as Promise<LicenseRenewalRequest>;
    }

    const formData = new FormData();
    formData.append("type", type);
    formData.append("document", {
      uri: fileUri,
      type: "image/jpeg",
      name: "document.jpg",
    });

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new Error(err.message ?? `Upload failed ${response.status}`);
    }
    return response.json() as Promise<LicenseRenewalRequest>;
  },

  async submitRenewalRequest(
    token: string,
    requestId: string,
  ): Promise<LicenseRenewalRequest> {
    return httpPost<LicenseRenewalRequest>(
      `${BACKEND_URL}/licenses/renewal/${requestId}/submit`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
        logErrors: true,
      },
    );
  },

  async renewLicense(token: string, certificateUri: string) {
    const uploadUrl = `${BACKEND_URL}/licenses/renew`;

    try {
      const fileUri = certificateUri.replace("file://", "");
      const base64 = await fsReadAsStringAsync(fileUri, {
        encoding: "base64",
      });

      if (Platform.OS === "web") {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray as unknown as string], {
          type: "image/jpeg",
          lastModified: Date.now(),
        });

        const webFormData = new FormData();
        (
          webFormData as FormData & {
            append(n: string, v: Blob, f: string): void;
          }
        ).append("certificate", blob, "certificate.jpg");

        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: webFormData,
        });

        if (response.status !== 200 && response.status !== 201) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        return (await response.json()) as unknown;
      } else {
        const uploadResult = await FileSystem.uploadAsync(uploadUrl, fileUri, {
          httpMethod: "POST",
          uploadType: 1 as FileSystemUploadType,
          fieldName: "certificate",
          headers: { Authorization: `Bearer ${token}` },
        });

        if (uploadResult.status !== 200 && uploadResult.status !== 201) {
          throw new Error(`Upload failed with status ${uploadResult.status}`);
        }

        return JSON.parse(uploadResult.body) as Record<string, unknown>;
      }
    } catch (error) {
      logger.error("[LicenseApi] Renewal failed", error);
      throw error;
    }
  },
};
