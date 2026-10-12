import { applyDecorators } from "@nestjs/common";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/**
 * `sortBy` query parameter of a list endpoint: only the listed fields are
 * accepted (400 otherwise), so a client can never sort on an arbitrary column.
 */
export function SortByParam(fields: readonly string[]): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      enum: fields,
      description: "Champ de tri (liste blanche) ; absent : ordre par défaut",
    }),
    IsOptional(),
    IsIn(fields),
  );
}

/** `sortOrder` query parameter; ignored without `sortBy`. */
export function SortOrderParam(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      enum: SORT_ORDERS,
      description: "Sens du tri (défaut : asc) ; ignoré sans sortBy",
    }),
    IsOptional(),
    IsIn(SORT_ORDERS),
  );
}

/**
 * Prisma `orderBy` of a list: the whitelisted field's order (which ends with a
 * unique tie-breaker so offset pages never overlap), or the default one.
 */
export function listOrderBy<Field extends string, OrderBy>(
  sortBy: Field | undefined,
  sortOrder: SortOrder | undefined,
  orders: Record<Field, (order: SortOrder) => OrderBy[]>,
  fallback: OrderBy[],
): OrderBy[] {
  return sortBy ? orders[sortBy](sortOrder ?? "asc") : fallback;
}
