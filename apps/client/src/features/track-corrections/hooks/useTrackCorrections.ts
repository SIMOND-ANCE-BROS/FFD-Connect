import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  TrackCorrectionApi,
  type ApproveTrackCorrectionDto,
  type CreateTrackCorrectionDto,
  type TrackCorrectionStatus,
} from "../../../services/api/track-correction-api";

/** Une page suffit : la file reste courte (3 propositions max par piste). */
const PAGE_SIZE = 50;

export const trackCorrectionKeys = {
  all: ["track-corrections"] as const,
  mine: () => [...trackCorrectionKeys.all, "mine"] as const,
  admin: (status: TrackCorrectionStatus) =>
    [...trackCorrectionKeys.all, "admin", status] as const,
  pendingCount: () => [...trackCorrectionKeys.all, "pending-count"] as const,
};

/** « Mes propositions » de l'utilisateur connecté. */
export function useMyTrackCorrections(enabled = true) {
  return useQuery({
    queryKey: trackCorrectionKeys.mine(),
    queryFn: () => TrackCorrectionApi.listMine({ take: PAGE_SIZE }),
    enabled,
  });
}

/** File de modération (ADMIN) pour un statut. */
export function useAdminTrackCorrections(
  status: TrackCorrectionStatus,
  enabled = true,
) {
  return useQuery({
    queryKey: trackCorrectionKeys.admin(status),
    queryFn: () => TrackCorrectionApi.list({ status, take: PAGE_SIZE }),
    enabled,
  });
}

/**
 * Badge « propositions en attente » (ADMIN). Pas de polling : chaque requête
 * réveille un backend scale-to-zero ; on se contente du rafraîchissement au
 * montage/focus et des invalidations après une action.
 */
export function usePendingTrackCorrectionsCount(enabled: boolean): number {
  const { data } = useQuery({
    queryKey: trackCorrectionKeys.pendingCount(),
    queryFn: () => TrackCorrectionApi.pendingCount(),
    enabled,
    staleTime: 60_000,
  });
  return enabled && data ? data : 0;
}

/** Envoi d'une proposition — rafraîchit « Mes propositions » et le badge. */
export function useCreateTrackCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTrackCorrectionDto) =>
      TrackCorrectionApi.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: trackCorrectionKeys.all,
      });
    },
  });
}

export type ReviewTrackCorrectionInput =
  | { id: string; decision: "approve"; body: ApproveTrackCorrectionDto }
  | { id: string; decision: "reject"; comment?: string };

/**
 * Validation / refus (ADMIN). Invalide toujours, y compris en cas d'échec :
 * un 409 signifie qu'un autre admin a déjà tranché, la liste doit refléter
 * son choix.
 */
export function useReviewTrackCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReviewTrackCorrectionInput) =>
      input.decision === "approve"
        ? TrackCorrectionApi.approve(input.id, input.body)
        : TrackCorrectionApi.reject(input.id, input.comment),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: trackCorrectionKeys.all,
      });
    },
  });
}
