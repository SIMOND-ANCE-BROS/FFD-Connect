import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  TrackCorrectionApi,
  type ApproveTrackCorrectionDto,
  type CreateTrackCorrectionDto,
  type TrackCorrectionAdminDto,
  type TrackCorrectionStatus,
} from "../../../services/api/track-correction-api";

/**
 * Taille d'une page. Le plafond « 3 propositions en attente » est PAR
 * UTILISATEUR ET PAR PISTE : la file globale, elle, n'est pas bornée — d'où la
 * pagination (chargement de la page suivante en fin de liste).
 */
export const PAGE_SIZE = 20;

/** Plafond `take` du backend, pour la recherche ponctuelle d'une proposition. */
const MAX_TAKE = 100;

export const trackCorrectionKeys = {
  all: ["track-corrections"] as const,
  mine: () => [...trackCorrectionKeys.all, "mine"] as const,
  admin: (status: TrackCorrectionStatus) =>
    [...trackCorrectionKeys.all, "admin", status] as const,
  focused: (id: string) => [...trackCorrectionKeys.all, "focused", id] as const,
  pendingCount: () => [...trackCorrectionKeys.all, "pending-count"] as const,
};

interface PageMeta {
  skip: number;
  take: number;
  hasMore: boolean;
}

/** Offset de la page suivante, `undefined` quand tout est chargé. */
export function nextPageParam(last: { meta: PageMeta }): number | undefined {
  return last.meta.hasMore ? last.meta.skip + last.meta.take : undefined;
}

/** « Mes propositions » de l'utilisateur connecté, paginées. */
export function useMyTrackCorrections(enabled = true) {
  return useInfiniteQuery({
    queryKey: trackCorrectionKeys.mine(),
    queryFn: ({ pageParam }) =>
      TrackCorrectionApi.listMine({ skip: pageParam, take: PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: nextPageParam,
    enabled,
  });
}

/** File de modération (ADMIN) pour un statut, paginée. */
export function useAdminTrackCorrections(
  status: TrackCorrectionStatus,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: trackCorrectionKeys.admin(status),
    queryFn: ({ pageParam }) =>
      TrackCorrectionApi.list({ status, skip: pageParam, take: PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: nextPageParam,
    enabled,
  });
}

const SEARCH_ORDER: TrackCorrectionStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
];

/**
 * Proposition visée par une notification, quand elle n'est pas dans la page
 * affichée (file longue, ou déjà traitée par un autre admin). Pas d'endpoint
 * unitaire : on parcourt la première page large de chaque statut. Activé
 * seulement dans ce cas, donc au plus 3 requêtes à l'ouverture.
 */
export function useFocusedTrackCorrection(
  id: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: trackCorrectionKeys.focused(id ?? ""),
    queryFn: async (): Promise<TrackCorrectionAdminDto | null> => {
      for (const status of SEARCH_ORDER) {
        const page = await TrackCorrectionApi.list({ status, take: MAX_TAKE });
        const found = page.data.find((c) => c.id === id);
        if (found) return found;
      }
      return null;
    },
    enabled: enabled && !!id,
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
