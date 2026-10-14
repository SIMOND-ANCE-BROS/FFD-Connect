import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TrackApi } from "../../../services/api/track-api";
import { markLibraryStale } from "../../../stores/librarySync.store";
import { trackCorrectionKeys } from "../../track-corrections/hooks/useTrackCorrections";

/**
 * « Blacklister le titre » depuis la bibliothèque (ADMIN, #561).
 *
 * La bibliothèque vit dans LibraryContext, hors de React Query : le succès la
 * marque périmée (rechargement en arrière-plan, le titre en disparaît). La
 * file de modération, elle, est en React Query : invalidée pour refléter la
 * piste retirée.
 */
export function useBlacklistTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (trackId: string) => TrackApi.blacklistTrack(trackId),
    onSuccess: () => {
      markLibraryStale();
      void queryClient.invalidateQueries({ queryKey: trackCorrectionKeys.all });
    },
  });
}
