import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { ERROR_MESSAGES } from "../../../constants/errorMessages";
import { useErrorHandler } from "../../../hooks/useErrorHandler";
import { useLoadingState } from "../../../hooks/useLoadingState";
import {
  BackendService,
  LicenseRenewalDocument,
  LicenseRenewalDocumentType,
  LicenseRenewalRequest,
} from "../../../services/BackendService";
import { setMyRenewalStatus } from "./useMyRenewalStatus";

export type RenewalStep = "documents" | "submitted" | "approved" | "rejected";

export function useLicenseRenewalLogic() {
  const auth = useAuthRepository();
  const { withErrorHandling } = useErrorHandler();
  const { isLoading: loading } = useLoadingState();
  const queryClient = useQueryClient();
  const [request, setRequestState] = useState<LicenseRenewalRequest | null>(
    null,
  );
  // Every fresh request also updates the status cache read by the
  // « en cours de vérification » banners of the Licence and Profile screens.
  const setRequest = useCallback(
    (next: LicenseRenewalRequest | null) => {
      setRequestState(next);
      setMyRenewalStatus(queryClient, next);
    },
    [queryClient],
  );
  const [uploadingType, setUploadingType] =
    useState<LicenseRenewalDocumentType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadRenewal = useCallback(async () => {
    const config = await auth.getAuthConfig();
    if (!config.authToken || !config.isLoggedIn) {
      setRequest(null);
      return;
    }
    try {
      const data = await BackendService.getMyRenewalRequest(config.authToken);
      setRequest(data ?? null);
    } catch {
      // Local state only: a failed read (network, 5xx, cold start) says
      // nothing about the request, and writing null to the shared cache
      // would erase a real PENDING from the Licence and Profile banners.
      setRequestState(null);
    }
  }, [auth, setRequest]);

  useEffect(() => {
    loadRenewal().catch(() => {});
  }, [loadRenewal]);

  const startOrGetDraft = useCallback(async () => {
    const config = await auth.getAuthConfig();
    if (!config.authToken || !config.isLoggedIn) {
      throw new Error(ERROR_MESSAGES.LOGIN_REQUIRED);
    }
    await withErrorHandling(
      async () => {
        const data = await BackendService.startRenewalRequest(
          config.authToken!,
        );
        setRequest(data);
      },
      {
        userMessage: ERROR_MESSAGES.RENEWAL_LOAD_FAILED,
        showAlert: true,
        logError: true,
      },
    );
  }, [auth, setRequest, withErrorHandling]);

  const pickAndUploadDocument = useCallback(
    async (type: LicenseRenewalDocumentType) => {
      const config = await auth.getAuthConfig();
      if (!config.authToken || !config.isLoggedIn) return;
      let req = request;
      if (req?.status !== "DRAFT") {
        await startOrGetDraft();
        req = await BackendService.getMyRenewalRequest(config.authToken).then(
          (r) => r ?? null,
        );
      }
      if (!req) return;

      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (status !== "granted") {
        withErrorHandling(
          () => {
            throw new Error("Accès à la galerie refusé");
          },
          { showAlert: true },
        ).catch(() => {});
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.9,
      });

      if (result.canceled || !result.assets[0].uri) return;

      setUploadingType(type);
      await withErrorHandling(
        async () => {
          const updated = await BackendService.uploadRenewalDocument(
            config.authToken!,
            req.id,
            type,
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            result.assets![0].uri,
          );
          setRequest(updated);
        },
        {
          userMessage: ERROR_MESSAGES.RENEWAL_UPLOAD_FAILED,
          showAlert: true,
          logError: true,
        },
      );
      setUploadingType(null);
    },
    [auth, request, setRequest, startOrGetDraft, withErrorHandling],
  );

  const submit = useCallback(async () => {
    if (request?.status !== "DRAFT") return;
    const config = await auth.getAuthConfig();
    if (!config.authToken || !config.isLoggedIn) return;

    setSubmitting(true);
    await withErrorHandling(
      async () => {
        const updated = await BackendService.submitRenewalRequest(
          config.authToken!,
          request.id,
        );
        setRequest(updated);
      },
      {
        userMessage: ERROR_MESSAGES.RENEWAL_SUBMIT_FAILED,
        showAlert: true,
        logError: true,
      },
    );
    setSubmitting(false);
  }, [auth, request, setRequest, withErrorHandling]);

  const getDoc = (
    type: LicenseRenewalDocumentType,
  ): LicenseRenewalDocument | undefined =>
    request?.documents.find((d) => d.type === type);

  const canSubmit =
    request?.status === "DRAFT" &&
    getDoc("MEDICAL_CERTIFICATE") &&
    getDoc("LICENSE_CERTIFICATE");

  const step: RenewalStep =
    request?.status === "APPROVED"
      ? "approved"
      : request?.status === "REJECTED"
        ? "rejected"
        : request?.status === "PENDING"
          ? "submitted"
          : "documents";

  return {
    request,
    loading,
    uploadingType,
    submitting,
    canSubmit,
    step,
    getDoc,
    loadRenewal,
    startOrGetDraft,
    pickAndUploadDocument,
    submit,
  };
}
