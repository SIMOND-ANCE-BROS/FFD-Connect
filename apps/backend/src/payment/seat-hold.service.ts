import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { handlePrismaError } from "../utils/prisma-errors.util";
import {
  seatBookingLapseSelect,
  seatBookingHoldSelect,
  seatBookingPendingSlotSelect,
  seatBookingSeatIndexSelect,
} from "../utils/prisma-selects";
import {
  MAX_ELEMENT_SEATS,
  checkRequestedSeat,
  firstFreeIndex,
  type BookableSeats,
} from "./seat-layout";

/**
 * How long a seat is held while its HelloAsso checkout is in progress (#428).
 * HelloAsso considers a checkout abandoned after 45 minutes without an
 * authorised payment (verified in sandbox, #404): 45 min + 5 min for the
 * notification to reach us, so that a payment HelloAsso still accepts does
 * not routinely arrive after the hold.
 */
export const SEAT_HOLD_DURATION_MS = 50 * 60 * 1000;

/**
 * A resumed payment pushes the deadline back (a fresh checkout page gets a
 * full hold), but never beyond this lifetime counted from the booking's
 * creation: nobody can keep a seat indefinitely by resuming.
 */
export const MAX_HOLD_LIFETIME_MS = 2 * SEAT_HOLD_DURATION_MS;

/** At most 4 PENDING bookings per user and competition (#428). */
export const MAX_PENDING_PER_COMPETITION = 4;

/**
 * Re-hold cooldown (#455): a user who let a hold expire cannot hold the same
 * seat again before this many minutes (`SEAT_REHOLD_COOLDOWN_MINUTES`, 0
 * disables it). Without it, one account could keep up to 4 seats forever by
 * re-holding each one the moment it lapses, never paying.
 */
export const DEFAULT_REHOLD_COOLDOWN_MINUTES = 30;
export const REHOLD_COOLDOWN_ENV = "SEAT_REHOLD_COOLDOWN_MINUTES";
const MAX_REHOLD_COOLDOWN_MINUTES = 24 * 60;

/** Configured re-hold cooldown in ms; an invalid value falls back to the default. */
export function resolveReholdCooldownMs(configService: ConfigService): number {
  const configured: unknown = configService.get(REHOLD_COOLDOWN_ENV);
  const minutes =
    typeof configured === "string" && configured.trim() !== ""
      ? Number(configured)
      : configured;
  const valid =
    typeof minutes === "number" &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= MAX_REHOLD_COOLDOWN_MINUTES;
  return (valid ? minutes : DEFAULT_REHOLD_COOLDOWN_MINUTES) * 60 * 1000;
}

// Each lost race means another checkout succeeded: one more attempt than the
// pending cap always ends on a real answer (seat taken, full, or cap).
const MAX_ATTEMPTS = MAX_PENDING_PER_COMPETITION + 1;

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED"] as const;

export type HeldBooking = Prisma.SeatBookingGetPayload<{
  select: typeof seatBookingHoldSelect;
}>;

export interface HoldRequest {
  userId: string;
  competitionId: string;
  itemId: string;
  seats: BookableSeats;
  /** Numbered seat chosen by the buyer; omitted → the server picks one. */
  seatIndex?: number;
  /** Display only, never trusted (#428). */
  seatLabel?: string;
  amountCents: number;
}

/** An unpaid hold of the user that lapsed within the cooldown (#455). */
interface Lapse {
  seatIndex: number | null;
  expiresAt: Date;
}

export type HoldResult =
  | { resumed: false; booking: HeldBooking }
  | { resumed: true; booking: HeldBooking };

const SEAT_ERRORS = {
  out_of_range: "Cette place n'existe pas sur cet élément du plan.",
  locked: "Cette place n'est pas réservable.",
  not_numbered:
    "Les places de cet élément ne sont pas numérotées : ne choisissez pas de numéro de place.",
} as const;

const SEAT_TAKEN = "Cette place est déjà réservée. Choisissez une autre place.";
const ELEMENT_FULL = "Il n'y a plus de place disponible sur cet élément.";
const reholdCooldownMessage = (minutes: number): string =>
  `Vous avez laissé expirer votre réservation de cette place. Vous pourrez la réserver de nouveau dans ${minutes} minute${minutes > 1 ? "s" : ""}.`;
const PENDING_CAP = `Vous avez déjà ${MAX_PENDING_PER_COMPETITION} réservations en attente de paiement pour cette compétition. Finalisez ou laissez expirer l'une d'elles.`;

/**
 * PENDING holds whose deadline is over (or missing) at `now` (#401). Holds
 * expire lazily: there is no scheduled purge (scale-to-zero, see CLAUDE.md),
 * they are switched to EXPIRED when they get in the way of a new checkout or
 * when their late payment arrives.
 */
export function lapsedHoldWhere(now: Date) {
  return {
    status: "PENDING" as const,
    OR: [{ expiresAt: null }, { expiresAt: { lte: now } }],
  };
}

/** Deadline of a hold whose payment is resumed with a fresh checkout page. */
export function resumedHoldDeadline(
  booking: Pick<HeldBooking, "expiresAt" | "createdAt">,
  now: Date,
): Date {
  const cap = booking.createdAt.getTime() + MAX_HOLD_LIFETIME_MS;
  const wanted = Math.min(now.getTime() + SEAT_HOLD_DURATION_MS, cap);
  const current = booking.expiresAt?.getTime() ?? 0;
  return new Date(Math.max(current, wanted));
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * Seat holds of the HelloAsso checkout (#401, #402, #428) — the database
 * writes; the payment itself is `PaymentService`.
 *
 * Every guarantee is a partial unique index, so it holds under concurrency
 * without a transaction (insert, and on a unique violation re-check and
 * retry):
 * - one active booking (PENDING or CONFIRMED) per seat — per place slot for
 *   free placement, which caps the element at its capacity
 *   (`SeatBooking_active_seat_index_key`);
 * - at most 4 PENDING bookings per user and competition, each in one of the
 *   pending slots 0..3 (`SeatBooking_pending_cap_key` + CHECK).
 *
 * The re-hold cooldown (#455) is a plain read: concurrent checkouts of the
 * same user all see the same EXPIRED row, so it holds without a lock.
 */
@Injectable()
export class SeatHoldService {
  private readonly reholdCooldownMs: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.reholdCooldownMs = resolveReholdCooldownMs(configService);
  }

  /**
   * Holds the requested seat for the user, or returns the user's own PENDING
   * booking of that seat (resume, #428) instead of a 409.
   */
  async hold(request: HoldRequest): Promise<HoldResult> {
    const seatError = checkRequestedSeat(request.seats, request.seatIndex);
    if (seatError) throw new BadRequestException(SEAT_ERRORS[seatError]);

    const now = new Date();
    // Lapsed holds of this element (they no longer block its seats) and of
    // this user in this competition (they no longer count in the cap).
    await this.prisma.seatBooking.updateMany({
      where: {
        competitionId: request.competitionId,
        AND: [
          { OR: [{ itemId: request.itemId }, { userId: request.userId }] },
          lapsedHoldWhere(now),
        ],
      },
      data: { status: "EXPIRED" },
    });

    const own = await this.findOwnPendingHold(request);
    if (own) return { resumed: true, booking: own };

    // Re-hold cooldown (#455). "First free seat" of a numbered element just
    // skips the seats the user let expire; any other request for them (the
    // seat named explicitly, or a free-placement element whose places are
    // interchangeable) is refused.
    const lapses = await this.recentLapses(request, now);
    const pickSeat =
      request.seats.mode === "numbered" && request.seatIndex === undefined;
    if (lapses.length > 0 && !pickSeat) {
      throw this.cooldownConflict(lapses[0], now);
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const pendingSlot = await this.freePendingSlot(request);
      const seatIndex = await this.freeSeatIndex(request, lapses, now);
      try {
        const booking = await this.prisma.seatBooking.create({
          data: {
            competitionId: request.competitionId,
            userId: request.userId,
            itemId: request.itemId,
            seatIndex,
            seatLabel: request.seatLabel,
            pendingSlot,
            status: "PENDING",
            expectedAmountCents: request.amountCents,
            expiresAt: new Date(now.getTime() + SEAT_HOLD_DURATION_MS),
          },
          select: seatBookingHoldSelect,
        });
        return { resumed: false, booking };
      } catch (err) {
        // Lost a race on the seat or on the pending slot: the next attempt
        // re-reads both and answers 409 if it is really taken or full.
        if (!isUniqueViolation(err)) handlePrismaError(err, "SeatBooking");
      }
    }
    throw new ConflictException(
      "Cette place vient d'être réservée. Réessayez ou choisissez une autre place.",
    );
  }

  /** Records the checkout intent created for a new hold. */
  async recordIntent(
    bookingId: string,
    intent: { id: string; redirectUrl: string },
    now: Date,
  ): Promise<void> {
    await this.prisma.seatBooking.update({
      where: { id: bookingId },
      data: {
        paymentId: intent.id,
        checkoutRedirectUrl: intent.redirectUrl,
        checkoutCreatedAt: now,
      },
      select: { id: true },
    });
  }

  /**
   * Swaps a resumed booking to a fresh checkout intent, keeping the previous
   * one (still payable on a page opened before) in `supersededPaymentIds`,
   * and pushes the deadline back within `MAX_HOLD_LIFETIME_MS`. Conditional
   * on the booking still being the same PENDING hold: `false` when a
   * concurrent checkout or notification changed it meanwhile.
   */
  async replaceIntent(
    booking: HeldBooking,
    intent: { id: string; redirectUrl: string },
    now: Date,
  ): Promise<{ replaced: boolean; expiresAt: Date }> {
    const expiresAt = resumedHoldDeadline(booking, now);
    const { count } = await this.prisma.seatBooking.updateMany({
      where: {
        id: booking.id,
        status: "PENDING",
        paymentId: booking.paymentId,
        expiresAt: { gt: now },
      },
      data: {
        paymentId: intent.id,
        checkoutRedirectUrl: intent.redirectUrl,
        checkoutCreatedAt: now,
        expiresAt,
        ...(booking.paymentId
          ? { supersededPaymentIds: { push: booking.paymentId } }
          : {}),
      },
    });
    return { replaced: count === 1, expiresAt };
  }

  /** Frees a hold whose checkout intent could not be created. */
  async release(bookingId: string): Promise<void> {
    await this.prisma.seatBooking
      .deleteMany({ where: { id: bookingId, status: "PENDING" } })
      .catch(() => {});
  }

  /**
   * The user's PENDING booking of the requested seat — or, without a seat
   * index, their latest PENDING booking on the element (a buyer who closed
   * the HelloAsso page and tries again).
   */
  private findOwnPendingHold(request: HoldRequest) {
    return this.prisma.seatBooking.findFirst({
      where: {
        competitionId: request.competitionId,
        itemId: request.itemId,
        userId: request.userId,
        status: "PENDING",
        ...(request.seatIndex === undefined
          ? {}
          : { seatIndex: request.seatIndex }),
      },
      orderBy: { createdAt: "desc" },
      select: seatBookingHoldSelect,
    });
  }

  /**
   * The user's UNPAID holds of the element (of the requested seat, when one
   * is named) that expired less than the cooldown ago (#455), latest first.
   * The seat stays open to other buyers meanwhile.
   *
   * A hold whose late payment was received (refund owed, or refunded since:
   * `cancelReason`) is a genuine buyer, never penalised. Resuming one's own
   * PENDING hold is handled before.
   */
  private async recentLapses(
    request: HoldRequest,
    now: Date,
  ): Promise<Lapse[]> {
    if (this.reholdCooldownMs === 0) return [];
    const lapses = await this.prisma.seatBooking.findMany({
      where: {
        competitionId: request.competitionId,
        userId: request.userId,
        itemId: request.itemId,
        status: "EXPIRED",
        expiresAt: { gt: new Date(now.getTime() - this.reholdCooldownMs) },
        refundOwedPaymentIds: { isEmpty: true },
        cancelReason: null,
        ...(request.seatIndex === undefined
          ? {}
          : { seatIndex: request.seatIndex }),
      },
      orderBy: { expiresAt: "desc" },
      select: seatBookingLapseSelect,
      take: MAX_ELEMENT_SEATS + 1,
    });
    return lapses.filter((lapse): lapse is Lapse => lapse.expiresAt !== null);
  }

  /** 409 telling when the seat of `lapse` can be held again. */
  private cooldownConflict(lapse: Lapse, now: Date): ConflictException {
    const remainingMs =
      lapse.expiresAt.getTime() + this.reholdCooldownMs - now.getTime();
    return new ConflictException(
      reholdCooldownMessage(Math.max(1, Math.ceil(remainingMs / 60_000))),
    );
  }

  private async freePendingSlot(request: HoldRequest): Promise<number> {
    const pending = await this.prisma.seatBooking.findMany({
      where: {
        competitionId: request.competitionId,
        userId: request.userId,
        status: "PENDING",
      },
      select: seatBookingPendingSlotSelect,
      // Rows without a slot (pre-#428) count too: one more than the cap is
      // enough to know it is reached.
      take: MAX_PENDING_PER_COMPETITION + 1,
    });
    const slot =
      pending.length < MAX_PENDING_PER_COMPETITION
        ? firstFreeIndex(
            MAX_PENDING_PER_COMPETITION,
            new Set(pending.map((p) => p.pendingSlot ?? -1)),
            new Set(),
          )
        : null;
    if (slot === null) throw new ConflictException(PENDING_CAP);
    return slot;
  }

  /**
   * `lapses` (#455) only matter for "first free seat" on a numbered element:
   * those seats are skipped, and when only they are left a 409 tells when
   * the soonest one frees up.
   */
  private async freeSeatIndex(
    request: HoldRequest,
    lapses: readonly Lapse[],
    now: Date,
  ): Promise<number> {
    const active = await this.prisma.seatBooking.findMany({
      where: {
        competitionId: request.competitionId,
        itemId: request.itemId,
        status: { in: [...ACTIVE_STATUSES] },
      },
      select: seatBookingSeatIndexSelect,
      take: MAX_ELEMENT_SEATS + 1,
    });
    // A booking made before #428 holds the whole element.
    if (active.some((b) => b.seatIndex === null)) {
      throw new ConflictException(SEAT_TAKEN);
    }
    const taken = new Set(active.map((b) => b.seatIndex as number));
    const { seats } = request;

    if (seats.mode === "free") {
      // Counted as well as indexed: after a capacity cut, live rows may sit
      // on slots beyond the new capacity.
      const slot =
        active.length < seats.places
          ? firstFreeIndex(seats.places, taken, new Set())
          : null;
      if (slot === null) throw new ConflictException(ELEMENT_FULL);
      return slot;
    }
    if (request.seatIndex !== undefined) {
      if (taken.has(request.seatIndex)) throw new ConflictException(SEAT_TAKEN);
      return request.seatIndex;
    }
    const cooling = new Set(
      lapses.flatMap((lapse) =>
        lapse.seatIndex === null ? [] : [lapse.seatIndex],
      ),
    );
    const seat = firstFreeIndex(
      seats.seats,
      taken,
      new Set([...seats.locked, ...cooling]),
    );
    if (seat !== null) return seat;
    // Only seats in cooldown are left: tell when the soonest one frees up
    // (lapses are latest first).
    const soonest = lapses
      .filter(
        (lapse) =>
          lapse.seatIndex !== null &&
          lapse.seatIndex < seats.seats &&
          !taken.has(lapse.seatIndex) &&
          !seats.locked.has(lapse.seatIndex),
      )
      .at(-1);
    if (soonest) throw this.cooldownConflict(soonest, now);
    throw new ConflictException(ELEMENT_FULL);
  }
}
