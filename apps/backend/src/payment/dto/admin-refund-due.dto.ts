import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { AdminPageMetaDto } from "../../admin/dto/admin-audit.dto";
import {
  SortByParam,
  SortOrderParam,
  type SortOrder,
} from "../../common/dto/sort-params";
import {
  type FilterColumns,
  type ListFilter,
  type TextCondition,
} from "../../common/list-filters/list-filters";
import {
  ListFiltersParam,
  listFilterSchema,
} from "../../common/list-filters/list-filters.dto";
import { ClubRefundDueDto } from "./club-refund-due.dto";

export const ADMIN_REFUNDS_DUE_PAGE_DEFAULT = 20;
export const ADMIN_REFUNDS_DUE_PAGE_MAX = 50;

/**
 * Club organisateur d'une compétition : le club relié (#408) ou, à défaut,
 * le libellé saisi sur la compétition (id null).
 */
export class AdminRefundDueClubDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: "Club relié ; null : compétition pas encore reliée à un club",
  })
  id!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Nom du club relié, sinon libellé de l'organisateur",
  })
  name!: string | null;
}

/** Un remboursement dû, avec le club organisateur qui le doit (#627). */
export class AdminRefundDueDto extends ClubRefundDueDto {
  @ApiProperty({ type: AdminRefundDueClubDto })
  club!: AdminRefundDueClubDto;
}

export class AdminRefundsDuePageDto {
  @ApiProperty({ type: [AdminRefundDueDto] })
  data!: AdminRefundDueDto[];

  @ApiProperty({ type: AdminPageMetaDto })
  meta!: AdminPageMetaDto;
}

const nameMatches = (c: TextCondition) => ({
  user: { is: { OR: [{ lastName: c }, { firstName: c }] } },
});

/**
 * Columns the admin list of refunds due can be filtered on, with operators
 * (#557). `club` matches the linked club's name or, for an unlinked
 * competition, its organiser label.
 */
export const ADMIN_REFUNDS_DUE_FILTER_COLUMNS: FilterColumns<Prisma.SeatBookingWhereInput> =
  {
    club: {
      kind: "text",
      where: (c) => ({
        competition: {
          is: {
            OR: [
              { organizerClub: { is: { name: c } } },
              { organizerClubId: null, organizer: c },
            ],
          },
        },
      }),
      // No linked club and no label: nobody known to owe it.
      whereNull: {
        competition: { is: { organizerClubId: null, organizer: null } },
      },
    },
    competition: {
      kind: "text",
      where: (c) => ({ competition: { is: { title: c } } }),
    },
    competitionDate: {
      kind: "date",
      where: (c) => ({ competition: { is: { date: c } } }),
    },
    dancer: { kind: "text", where: nameMatches },
    refundOwedAt: {
      kind: "date",
      where: (c) => ({ refundOwedAt: c }),
    },
  };
export const AdminRefundsDueFilterDto = listFilterSchema(
  "AdminRefundsDueFilterDto",
  Object.keys(ADMIN_REFUNDS_DUE_FILTER_COLUMNS),
);

/** Columns the list can be sorted on (#443). */
export const ADMIN_REFUNDS_DUE_SORT_FIELDS = [
  "club",
  "competition",
  "competitionDate",
  "amount",
  "refundOwedAt",
] as const;
export type AdminRefundsDueSortField =
  (typeof ADMIN_REFUNDS_DUE_SORT_FIELDS)[number];

export class ListAdminRefundsDueQueryDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_REFUNDS_DUE_PAGE_MAX,
    default: ADMIN_REFUNDS_DUE_PAGE_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_REFUNDS_DUE_PAGE_MAX)
  take?: number;

  @SortByParam(ADMIN_REFUNDS_DUE_SORT_FIELDS)
  sortBy?: AdminRefundsDueSortField;

  @SortOrderParam()
  sortOrder?: SortOrder;

  @ListFiltersParam(ADMIN_REFUNDS_DUE_FILTER_COLUMNS)
  filters?: ListFilter[];
}
