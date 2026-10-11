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
import { queryClient } from "../../../services/queryClient";
import { renewalStatusQueryKey } from "./useRenewalPending";

export type RenewalStep = "documents" | "submitted" | "approved" | "rejected";

export function useLicenseRenewalLogic() {
  const auth = useAuthRepository();
  const { withErrorHandling } = useErrorHandler();
  const { isLoading: loading } = useLoadingState();
  const [request, setRequest] = useState<LicenseRenewalRequest | null>(null);
  const [uploadingType, setUploadingType] =
    useState<LicenseRenewalDocumentType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The Licence and Profile banners read the status from React Query (#268):
  // keep it in step with what this screen loads or submits.
  const applyRequest = useCallback((next: LicenseRenewalRequest | null) => {
    setRequest(next);
    const queryKey = renewalStatusQueryKey();
    // A banner fetch still in flight (waking backend) would land after this
    // write and overwrite it with an older status: cancel it first. The
    // cancellation reverts asynchronously, hence the write once it settled.
    void queryClient
      .cancelQueries({ queryKey })
      .then(() => queryClient.setQueryData(queryKey, next?.status ?? null));
  }, []);

  const loadRenewal = useCallback(async () => {
    const config = await auth.getAuthConfig();
    if (!config.authToken || !config.isLoggedIn) {
      applyRequest(null);
      return;
    }
    try {
      const data = await BackendService.getMyRenewalRequest(config.authToken);
      applyRequest(data ?? null);
    } catch {
      // Unknown, not "none": the banners keep what they last knew.
      setRequest(null);
    }
  }, [auth, applyRequest]);

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
        applyRequest(data);
      },
      {
        userMessage: ERROR_MESSAGES.RENEWAL_LOAD_FAILED,
        showAlert: true,
        logError: true,
      },
    );
  }, [auth, applyRequest, withErrorHandling]);

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
          applyRequest(updated);
        },
        {
          userMessage: ERROR_MESSAGES.RENEWAL_UPLOAD_FAILED,
          showAlert: true,
          logError: true,
        },
      );
      setUploadingType(null);
    },
    [auth, request, startOrGetDraft, withErrorHandling, applyRequest],
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
        applyRequest(updated);
      },
      {
        userMessage: ERROR_MESSAGES.RENEWAL_SUBMIT_FAILED,
        showAlert: true,
        logError: true,
      },
    );
    setSubmitting(false);
  }, [auth, request, withErrorHandling, applyRequest]);

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
