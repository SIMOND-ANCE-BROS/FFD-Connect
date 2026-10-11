import {
  EVENTS_SOURCE_NOTICES,
  type BetaNoticeCopy,
} from "../../../constants/betaNotices";

export interface EventsSourceNotice {
  copy: BetaNoticeCopy;
  /** Circular to open from the notice, when one is known. */
  circularUrl: string | null;
}

interface EventsSourceInput {
  /** Only competitions synced from the federation get a notice. */
  ffdId?: string | null;
  /** `CompetitionEventsSource`; any other value is treated as GENERIC. */
  eventsSource?: string | null;
  circularUrl?: string | null;
}

/**
 * Picks the notice explaining where the events of a competition come from.
 * Tolerates backends that do not send `eventsSource` yet (treated as GENERIC)
 * and unknown values. Returns null for competitions not synced from the
 * federation (club-created events are authoritative).
 */
export function getEventsSourceNotice(
  competition: EventsSourceInput,
): EventsSourceNotice | null {
  if (!competition.ffdId) return null;
  // Blank URLs count as missing.
  const trimmedUrl = competition.circularUrl?.trim() ?? "";
  const circularUrl = trimmedUrl.length > 0 ? trimmedUrl : null;

  switch (competition.eventsSource) {
    case "CIRCULAR":
      return { copy: EVENTS_SOURCE_NOTICES.deducedFromCircular, circularUrl };
    case "DESCRIPTION":
      return {
        copy: EVENTS_SOURCE_NOTICES.deducedFromDescription,
        circularUrl,
      };
    default:
      return circularUrl
        ? { copy: EVENTS_SOURCE_NOTICES.circularUnreadable, circularUrl }
        : { copy: EVENTS_SOURCE_NOTICES.notYetPublished, circularUrl: null };
  }
}
