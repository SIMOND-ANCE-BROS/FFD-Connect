import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { hasRole } from "../auth/roles";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import {
  organizedByClubWhere,
  organizerActorOf,
  organizerMatcher,
  type OrganizerClubActor,
} from "../competitions/competition-organizer";
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
 * Bound on the club's candidate competitions that currently have a refund
 * owed. Refunds owed are exceptional (late or duplicate payments); past this
 * bound the oldest-dated competitions would be left out.
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
 * "Organised by the caller's club" is the rule of the organiser rights
 * (#408, CompetitionAccessService, via `organizerMatcher`): the
 * `organizerClubId` link; an unlinked competition only when its label
 * designates exactly the caller's club — a homonym label grants nobody, so a
 * club never sees another club's dancers.
 */
@Injectable()
export class ClubRefundsDueQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listForClubManager(
    userId: string,
    skip = 0,
    take = DEFAULT_REFUNDS_DUE_PAGE_SIZE,
  ): Promise<ClubRefundsDuePageDto> {
    const actor = await this.clubActorOf(userId);
    const competitionIds = await this.competitionsWithRefundsOwed(actor);
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

  /** The requester as a club actor (its club id and names), CLUB role only. */
  private async clubActorOf(userId: string): Promise<OrganizerClubActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userRolesClubNameSelect,
    });
    if (!user) throw new NotFoundException("User not found");
    if (!hasRole(user, UserRole.CLUB)) {
      throw new ForbiddenException("Only a club account can list its refunds");
    }
    return organizerActorOf(this.prisma, user);
  }

  /**
   * Ids of the competitions organised by the actor's club that have a refund
   * owed: candidates from `organizedByClubWhere` (a superset), filtered by
   * `organizerMatcher`.
   */
  private async competitionsWithRefundsOwed(
    actor: OrganizerClubActor,
  ): Promise<string[]> {
    const organizedBy = organizedByClubWhere(actor);
    if (!organizedBy) return [];
    const candidates = await this.prisma.competition.findMany({
      where: {
        AND: [
          organizedBy,
          { seatBookings: { some: { refundOwedAt: { not: null } } } },
        ],
      },
      select: competitionIdOrganizerSelect,
      orderBy: { date: "desc" },
      take: MAX_COMPETITIONS_WITH_REFUNDS,
    });
    if (candidates.length === 0) return [];
    const isMine = await organizerMatcher(this.prisma, candidates, actor);
    return candidates.filter(isMine).map((c) => c.id);
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
