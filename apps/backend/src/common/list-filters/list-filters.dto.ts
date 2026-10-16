import { applyDecorators, type Type } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, ValidateBy } from "class-validator";
import {
  describeFilterColumns,
  type FilterColumns,
  LIST_FILTER_JOINS,
  LIST_FILTER_OPS,
  type ListFilterJoin,
  type ListFilterOp,
  listFiltersError,
  MAX_FIELD_CONDITIONS,
  MAX_LIST_FILTERS,
  parseListFiltersParam,
} from "./list-filters";

/**
 * `filters` query parameter of a back-office list (#557): a JSON array of
 * `{ field, op, value, join }`. The conditions of one field combine by their
 * `join` (#673), different fields with AND. Fields, operators, values and
 * counts are checked against `columns` (400 otherwise, with the first problem
 * in the message).
 */
export function ListFiltersParam<Where>(
  columns: FilterColumns<Where>,
): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      type: String,
      description:
        `Filtres de colonne, tableau JSON de { field, op, value, join }. ` +
        `Un champ peut porter jusqu'à ${MAX_FIELD_CONDITIONS} conditions, ` +
        `reliées par join (and par défaut, or : identique pour toutes les ` +
        `conditions du champ) ; les champs différents sont combinés par ET ` +
        `(${MAX_LIST_FILTERS} conditions au plus). Dates AAAA-MM-JJ (jours de Paris) ; ` +
        `between : [début, fin] inclus ; in / notIn : liste de valeurs ; ` +
        `isEmpty / isNotEmpty : sans value. Champs : ${describeFilterColumns(columns)}`,
    }),
    IsOptional(),
    Transform(({ value }: { value: unknown }) => parseListFiltersParam(value)),
    ValidateBy({
      name: "listFilters",
      validator: {
        validate: (value: unknown) => listFiltersError(columns, value) === null,
        defaultMessage: (args) =>
          listFiltersError(columns, args?.value) ?? "filters invalide",
      },
    }),
  );
}

/**
 * Schema of one filter of a list, named per list so the generated client
 * types its `field` as the exact whitelist (like the `sortBy` enums).
 */
export function listFilterSchema(
  name: string,
  fields: readonly string[],
): Type<unknown> {
  class ListFilterSchema {
    @ApiProperty({ enum: fields })
    field!: string;

    @ApiProperty({ enum: LIST_FILTER_OPS, enumName: "ListFilterOp" })
    op!: ListFilterOp;

    @ApiPropertyOptional({
      oneOf: [
        { type: "string" },
        { type: "number" },
        { type: "array", items: { type: "string" } },
        { type: "array", items: { type: "number" } },
      ],
      description: "Absente pour isEmpty / isNotEmpty",
    })
    value?: string | number | string[] | number[];

    @ApiPropertyOptional({
      enum: LIST_FILTER_JOINS,
      enumName: "ListFilterJoin",
      description:
        "Avec les autres conditions du même champ (and par défaut) : identique pour toutes",
    })
    join?: ListFilterJoin;
  }
  Object.defineProperty(ListFilterSchema, "name", { value: name });
  return ListFilterSchema;
}
