import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { listOrderBy, type SortOrder } from "../common/dto/sort-params";
import { listFiltersWhere } from "../common/list-filters/list-filters";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import { adminSeatBookingRefundDueSelect } from "../utils/prisma-selects";
import {
  ADMIN_REFUNDS_DUE_FILTER_COLUMNS,
  ADMIN_REFUNDS_DUE_PAGE_DEFAULT,
  type AdminRefundDueDto,
  type AdminRefundsDuePageDto,
  type AdminRefundsDueSortField,
  type ListAdminRefundsDueQueryDto,
} from "./dto/admin-refund-due.dto";

type Row = Prisma.SeatBookingGetPayload<{
  select: typeof adminSeatBookingRefundDueSelect;
}>;
type OrderBy = Prisma.SeatBookingOrderByWithRelationInput;

/** Every order ends with the id, so offset pages never overlap. */
const ORDERS: Record<AdminRefundsDueSortField, (o: SortOrder) => OrderBy[]> = {
  club: (o) => [
    { competition: { organizerClub: { name: o } } },
    { competition: { organizer: o } },
    { id: o },
  ],
  competition: (o) => [{ competition: { title: o } }, { id: o }],
  competitionDate: (o) => [{ competition: { date: o } }, { id: o }],
  amount: (o) => [
    { expectedAmountCents: { sort: o, nulls: "last" } },
    { id: o },
  ],
  refundOwedAt: (o) => [{ refundOwedAt: o }, { id: o }],
};

/** Oldest first, like the club's list: the longest-waiting payer first. */
const DEFAULT_ORDER: OrderBy[] = [{ refundOwedAt: "asc" }, { id: "asc" }];

/**
 * Refunds owed by every organising club (#627), for the federal
 * administrator: the club's own list (#516, ClubRefundsDueQueryService)
 * without the organiser restriction, with the organising club on each row.
 * Read-only: a refund is settled only by HelloAsso's `Refunded` notification
 * (ADR-0022).
 */
@Injectable()
export class AdminRefundsDueQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListAdminRefundsDueQueryDto,
  ): Promise<AdminRefundsDuePageDto> {
    const skip = query.skip ?? 0;
    const take = query.take ?? ADMIN_REFUNDS_DUE_PAGE_DEFAULT;
    const where: Prisma.SeatBookingWhereInput = {
      refundOwedAt: { not: null },
      ...(query.filters?.length && {
        AND: listFiltersWhere(ADMIN_REFUNDS_DUE_FILTER_COLUMNS, query.filters),
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.seatBooking.count({ where }),
      this.prisma.seatBooking.findMany({
        where,
        select: adminSeatBookingRefundDueSelect,
        orderBy: listOrderBy(
          query.sortBy,
          query.sortOrder,
          ORDERS,
          DEFAULT_ORDER,
        ),
        skip,
        take,
      }),
    ]);
    return createPaginatedResponse(rows.map(toDto), total, skip, take);
  }
}

function toDto(row: Row): AdminRefundDueDto {
  const { organizer, organizerClub, ...competition } = row.competition;
  return {
    bookingId: row.id,
    club: organizerClub
      ? { id: organizerClub.id, name: organizerClub.name }
      : { id: null, name: organizer },
    competition,
    dancer: { firstName: row.user.firstName, lastName: row.user.lastName },
    seatNumber: row.seatIndex === null ? null : row.seatIndex + 1,
    amountCents: row.expectedAmountCents,
    helloAssoCheckoutIntentIds: row.refundOwedPaymentIds,
    // Filtered on `not: null`; the fallback only satisfies the type.
    refundOwedAt: row.refundOwedAt ?? new Date(0),
  };
}
