import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { hasRole } from "../auth/roles";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  competitionIdOrganizerSelect,
  seatBookingRefundDueSelect,
  userRolesClubNameSelect,
} from "../utils/prisma-selects";
import type {
  ClubRefundDueDto,
  ClubRefundsDuePageDto,
} from "./dto/club-refund-due.dto";

type RefundDueRow = Prisma.SeatBookingGetPayload<{
  select: typeof seatBookingRefundDueSelect;
}>;

export const DEFAULT_REFUNDS_DUE_PAGE_SIZE = 20;

/**
 * Bound on the club's competitions that currently have a refund owed. Refunds
 * owed are exceptional (late or duplicate payments); past this bound the
 * oldest-dated competitions would be left out, which would need a real
 * organiser foreign key rather than a larger number.
 */
export const MAX_COMPETITIONS_WITH_REFUNDS = 200;

/**
 * Refunds the organising club owes (#516): bookings whose
 * `refundOwedPaymentIds` is not empty (`refundOwedAt` set), on competitions
 * the club organises. Read-only: a refund is settled by HelloAsso's `Refunded`
 * notification once the club has refunded the payment from its HelloAsso
 * back-office (`SeatReleaseService`, ADR-0022), never by hand in the app —
 * our records follow what HelloAsso confirms.
 *
 * The organising club is matched on `Competition.organizer` like the
 * refund-owed alert and the HelloAsso credentials: the club name, trimmed,
 * case insensitive.
 */
@Injectable()
export class ClubRefundsDueQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listForClubManager(
    userId: string,
    skip = 0,
    take = DEFAULT_REFUNDS_DUE_PAGE_SIZE,
  ): Promise<ClubRefundsDuePageDto> {
    const clubName = await this.clubNameOf(userId);
    const competitionIds = clubName
      ? await this.competitionsWithRefundsOwed(clubName)
      : [];
    if (competitionIds.length === 0) {
      return createPaginatedResponse([], 0, skip, take);
    }

    const where: Prisma.SeatBookingWhereInput = {
      competitionId: { in: competitionIds },
      refundOwedAt: { not: null },
    };
    const [rows, total] = await Promise.all([
      this.prisma.seatBooking.findMany({
        where,
        select: seatBookingRefundDueSelect,
        // Oldest first: the longest-waiting payer is the most urgent.
        orderBy: [{ refundOwedAt: "asc" }, { id: "asc" }],
        skip,
        take,
      }),
      this.prisma.seatBooking.count({ where }),
    ]);
    return createPaginatedResponse(rows.map(toDto), total, skip, take);
  }

  /**
   * The requester's club name (its club, else the free-text club name of the
   * profile), without creating any club. `null` when the account has none.
   */
  private async clubNameOf(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userRolesClubNameSelect,
    });
    if (!user) throw new NotFoundException("User not found");
    if (!hasRole(user, UserRole.CLUB)) {
      throw new ForbiddenException("Only a club account can list its refunds");
    }
    const name = (user.club?.name ?? user.clubName)?.trim();
    if (!name) return null; // Blank club name: no club.
    return name;
  }

  /**
   * Ids of the competitions organised by `clubName` that have a refund owed.
   * `organizer` is free text that may carry surrounding spaces: the database
   * narrows with `contains`, the exact (trimmed, case-insensitive) match is
   * made here.
   */
  private async competitionsWithRefundsOwed(
    clubName: string,
  ): Promise<string[]> {
    const candidates = await this.prisma.competition.findMany({
      where: {
        organizer: { contains: clubName, mode: "insensitive" },
        seatBookings: { some: { refundOwedAt: { not: null } } },
      },
      select: competitionIdOrganizerSelect,
      orderBy: { date: "desc" },
      take: MAX_COMPETITIONS_WITH_REFUNDS,
    });
    const wanted = clubName.toLowerCase();
    return candidates
      .filter((c) => c.organizer?.trim().toLowerCase() === wanted)
      .map((c) => c.id);
  }
}

function toDto(row: RefundDueRow): ClubRefundDueDto {
  return {
    bookingId: row.id,
    competition: row.competition,
    dancer: { firstName: row.user.firstName, lastName: row.user.lastName },
    seatNumber: row.seatIndex === null ? null : row.seatIndex + 1,
    amountCents: row.expectedAmountCents,
    helloAssoCheckoutIntentIds: row.refundOwedPaymentIds,
    // Filtered on `not: null`; the fallback only satisfies the type.
    refundOwedAt: row.refundOwedAt ?? new Date(0),
  };
}
