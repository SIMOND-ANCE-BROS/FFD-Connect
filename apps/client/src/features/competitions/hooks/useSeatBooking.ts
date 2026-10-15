import { useFocusEffect } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  SeatBookingApi,
  SeatBookingError,
  SEAT_BOOKING_MESSAGES,
  type CheckoutResponseDto,
} from "../../../services/api/seat-booking-api";
import { openExternalUrl } from "../../../utils/externalUrl";
import { createLogger } from "../../../utils/logger";
import { useCompetitionRepository } from "../context/CompetitionContext";
import {
  canBookFreeElement,
  findOwnHeldSeat,
  isSelectable,
  isSelectionStillValid,
  joinOccupancy,
  parseSeatPlan,
  seatLabel,
  seatStatus,
  type BookableElement,
  type SeatSelection,
} from "../utils/seatPlan";

const logger = createLogger("useSeatBooking");

export const seatOccupancyQueryKey = (competitionId: string) =>
  ["seatOccupancy", competitionId] as const;

/** What the last checkout answered, shown until the next one. */
export interface SeatHold {
  label: string;
  expiresAt: string;
  resumed: boolean;
}

function selectionLabel(
  element: BookableElement,
  selection: SeatSelection,
): string {
  return selection.seatIndex === undefined
    ? element.label
    : `${element.label}, ${seatLabel(element, selection.seatIndex)}`;
}

/**
 * Seat picker of a competition (#453): the plan joined with its occupancy,
 * the selected seat and the HelloAsso checkout.
 *
 * Occupancy is read on mount and again each time the screen regains focus
 * (back from HelloAsso, back from another screen) — never polled: every
 * request wakes the scale-to-zero backend. A refused checkout (409: seat
 * taken meanwhile, element full, re-hold cooldown…) shows the server's
 * message, drops the selection and reloads the occupancy so the user can
 * pick again.
 */
export function useSeatBooking(competitionId: string) {
  const queryClient = useQueryClient();
  const { getCompetitionDetails } = useCompetitionRepository();

  const detailsQuery = useQuery({
    queryKey: ["competition", competitionId, "seatPlan"],
    queryFn: () => getCompetitionDetails(competitionId),
    enabled: !!competitionId,
    retry: false,
  });

  const occupancyQuery = useQuery({
    queryKey: seatOccupancyQueryKey(competitionId),
    queryFn: () => SeatBookingApi.getOccupancy(competitionId),
    enabled: !!competitionId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const refreshOccupancy = useCallback(() => {
    queryClient
      .invalidateQueries({ queryKey: seatOccupancyQueryKey(competitionId) })
      .catch(() => {});
  }, [queryClient, competitionId]);

  // First focus skipped: the query already runs on mount.
  const hasFocused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocused.current) {
        hasFocused.current = true;
        return;
      }
      refreshOccupancy();
    }, [refreshOccupancy]),
  );

  const elements = useMemo(
    () =>
      joinOccupancy(
        parseSeatPlan(detailsQuery.data?.layout),
        occupancyQuery.data?.elements ?? [],
      ),
    [detailsQuery.data?.layout, occupancyQuery.data?.elements],
  );

  // `undefined`: no choice made yet — the user's own held seat is then
  // preselected (booking it again resumes its payment). `null`: cleared.
  const [chosen, setChosen] = useState<SeatSelection | null | undefined>();
  const candidate = chosen === undefined ? findOwnHeldSeat(elements) : chosen;
  // A refresh may have given the chosen seat to someone else.
  const selection =
    candidate && isSelectionStillValid(candidate, elements) ? candidate : null;
  const selectedElement = selection
    ? (elements.find((element) => element.id === selection.itemId) ?? null)
    : null;

  const [hold, setHold] = useState<SeatHold | null>(null);

  const selectSeat = useCallback(
    (itemId: string, seatIndex: number) => {
      const element = elements.find((entry) => entry.id === itemId);
      if (element?.mode !== "numbered") return;
      if (!isSelectable(seatStatus(element, seatIndex))) return;
      setChosen((current) =>
        current?.itemId === itemId && current.seatIndex === seatIndex
          ? null
          : { itemId, seatIndex },
      );
    },
    [elements],
  );

  const selectFreeElement = useCallback(
    (itemId: string) => {
      const element = elements.find((entry) => entry.id === itemId);
      if (!element || !canBookFreeElement(element)) return;
      setChosen((current) =>
        current?.itemId === itemId && current.seatIndex === undefined
          ? null
          : { itemId },
      );
    },
    [elements],
  );

  const checkout = useMutation<
    CheckoutResponseDto,
    Error,
    { selection: SeatSelection; label: string }
  >({
    mutationFn: ({ selection: seat, label }) =>
      SeatBookingApi.checkout({
        competitionId,
        itemId: seat.itemId,
        seatIndex: seat.seatIndex,
        seatLabel: seat.seatIndex === undefined ? undefined : label,
      }),
    onSuccess: async (result, { label }) => {
      setHold({ label, expiresAt: result.expiresAt, resumed: result.resumed });
      refreshOccupancy();
      await openExternalUrl(result.redirectUrl);
    },
    onError: (error, variables) => {
      if (!(error instanceof SeatBookingError)) {
        logger.warn("Unexpected checkout failure", error);
        Alert.alert("Réservation impossible", SEAT_BOOKING_MESSAGES.checkout);
        return;
      }
      if (error.kind === "conflict") {
        setChosen(null);
        refreshOccupancy();
        Alert.alert("Place indisponible", error.userMessage);
        return;
      }
      if (error.kind === "unavailable") {
        Alert.alert("Paiement indisponible", error.userMessage, [
          { text: "Annuler", style: "cancel" },
          { text: "Réessayer", onPress: () => checkout.mutate(variables) },
        ]);
        return;
      }
      Alert.alert("Réservation impossible", error.userMessage);
    },
  });

  const pay = useCallback(() => {
    if (!selection || !selectedElement || checkout.isPending) return;
    checkout.mutate({
      selection,
      label: selectionLabel(selectedElement, selection),
    });
  }, [selection, selectedElement, checkout]);

  return {
    competitionTitle: detailsQuery.data?.title,
    isLoading: detailsQuery.isLoading || occupancyQuery.isLoading,
    isError: detailsQuery.isError || occupancyQuery.isError,
    isRefreshing: occupancyQuery.isFetching && !occupancyQuery.isLoading,
    elements,
    selection,
    selectedElement,
    selectedLabel:
      selection && selectedElement
        ? selectionLabel(selectedElement, selection)
        : null,
    hold,
    isPaying: checkout.isPending,
    selectSeat,
    selectFreeElement,
    pay,
    refresh: refreshOccupancy,
    /** After a load error: reload the plan and its occupancy. */
    reload: () => {
      detailsQuery.refetch().catch(() => {});
      occupancyQuery.refetch().catch(() => {});
    },
  };
}
