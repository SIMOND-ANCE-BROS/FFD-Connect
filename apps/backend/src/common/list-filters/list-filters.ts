import { BadRequestException } from "@nestjs/common";
import { parisStartOfDay } from "../../licenses/qr/license-qr";

/**
 * Column filters with operators of the back-office lists (#557) — pure, no Nest
 * module. A list endpoint declares a whitelist of filterable fields (a
 * {@link FilterColumns} map); a client sends `filters`, a JSON array of
 * `{ field, op, value }` combined with AND. Every field and operator is checked
 * against the whitelist and turned into a Prisma `where` by the column's own
 * builder: no client string ever names a column or reaches raw SQL.
 *
 * Text is matched case-insensitively (`mode: "insensitive"`, ILIKE). Accents
 * are NOT folded: the `unaccent` extension is not installed (see #557).
 */

export const TEXT_FILTER_OPS = [
  "contains",
  "notContains",
  "equals",
  "startsWith",
  "isEmpty",
  "isNotEmpty",
] as const;
export const RANGE_FILTER_OPS = [
  "lt",
  "gt",
  "eq",
  "between",
  "isEmpty",
  "isNotEmpty",
] as const;
export const ENUM_FILTER_OPS = ["in", "notIn", "isEmpty"] as const;
export const LIST_FILTER_OPS = [
  ...new Set([...TEXT_FILTER_OPS, ...RANGE_FILTER_OPS, ...ENUM_FILTER_OPS]),
] as const;

export type TextFilterOp = (typeof TEXT_FILTER_OPS)[number];
export type RangeFilterOp = (typeof RANGE_FILTER_OPS)[number];
export type EnumFilterOp = (typeof ENUM_FILTER_OPS)[number];
export type ListFilterOp = TextFilterOp | RangeFilterOp | EnumFilterOp;
export type FilterKind = "text" | "date" | "number" | "enum";

/** At most this many filters per request (they are ANDed). */
export const MAX_LIST_FILTERS = 10;
export const MAX_FILTER_TEXT_LENGTH = 100;
export const MAX_FILTER_ENUM_VALUES = 50;

export type ListFilterValue = string | number | string[] | number[];

/** One validated filter of a request. */
export interface ListFilter {
  field: string;
  op: ListFilterOp;
  value?: ListFilterValue;
}

/** Conditions a column builder receives: subsets of Prisma's scalar filters. */
export interface TextCondition {
  contains?: string;
  startsWith?: string;
  equals?: string;
  mode?: "insensitive";
}
export interface DateCondition {
  lt?: Date;
  gte?: Date;
}
export interface NumberCondition {
  lt?: number;
  gt?: number;
  gte?: number;
  lte?: number;
  equals?: number;
}

interface ColumnBase<Where> {
  /**
   * The row has no value (NULL, or no related record). Present only on a
   * nullable column: it enables « est vide » / « n'est pas vide » there, and
   * makes « ne contient pas » / « n'est aucune de » keep the empty rows.
   */
  whereNull?: Where;
}
export interface TextColumn<Where> extends ColumnBase<Where> {
  kind: "text";
  where: (condition: TextCondition) => Where;
}
export interface DateColumn<Where> extends ColumnBase<Where> {
  kind: "date";
  where: (condition: DateCondition) => Where;
}
export interface NumberColumn<Where> extends ColumnBase<Where> {
  kind: "number";
  where: (condition: NumberCondition) => Where;
}
export interface EnumColumn<Where> extends ColumnBase<Where> {
  kind: "enum";
  values: readonly string[];
  /** Rows whose value is `value` (one of `values`, already checked). */
  where: (value: string) => Where;
}
export type FilterColumn<Where> =
  | TextColumn<Where>
  | DateColumn<Where>
  | NumberColumn<Where>
  | EnumColumn<Where>;

/** Whitelist of the filterable fields of one list, by field name. */
export type FilterColumns<Where> = Readonly<
  Record<string, FilterColumn<Where>>
>;

/** An enumerated column whose builder only ever sees one of `values`. */
export function enumColumn<Value extends string, Where>(
  values: readonly Value[],
  where: (value: Value) => Where,
  whereNull?: Where,
): EnumColumn<Where> {
  const isValue = (value: string): value is Value =>
    (values as readonly string[]).includes(value);
  return {
    kind: "enum",
    values,
    whereNull,
    where: (value) => {
      if (!isValue(value))
        throw new BadRequestException("Valeur de filtre inconnue");
      return where(value);
    },
  };
}

/** Operators a column accepts: « est vide » only where a value can be missing. */
export function allowedOps(column: {
  kind: FilterKind;
  nullable: boolean;
}): readonly ListFilterOp[] {
  if (column.kind === "text") return TEXT_FILTER_OPS;
  const ops: readonly ListFilterOp[] =
    column.kind === "enum" ? ENUM_FILTER_OPS : RANGE_FILTER_OPS;
  return column.nullable
    ? ops
    : ops.filter((op) => op !== "isEmpty" && op !== "isNotEmpty");
}

const NO_VALUE_OPS: readonly ListFilterOp[] = ["isEmpty", "isNotEmpty"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const own = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

function rangeValueError(
  kind: "date" | "number",
  op: ListFilterOp,
  value: unknown,
): string | null {
  const isPoint = kind === "date" ? isCalendarDay : isFiniteNumber;
  const expected = kind === "date" ? "une date AAAA-MM-JJ" : "un nombre";
  if (op !== "between") {
    return isPoint(value) ? null : `attend ${expected}`;
  }
  if (!Array.isArray(value) || value.length !== 2) {
    return `attend deux bornes (${expected})`;
  }
  const [from, to] = value as readonly unknown[];
  if (!isPoint(from) || !isPoint(to)) return `attend deux bornes (${expected})`;
  return from <= to ? null : "bornes dans le désordre";
}

/** Shape check of the parsed `filters` parameter against `columns`; null when valid. */
export function listFiltersError<Where>(
  columns: FilterColumns<Where>,
  raw: unknown,
): string | null {
  if (!Array.isArray(raw)) {
    return "filters doit être un tableau JSON de { field, op, value }";
  }
  if (raw.length > MAX_LIST_FILTERS) {
    return `filters : ${MAX_LIST_FILTERS} filtres au plus`;
  }
  for (const [index, item] of (raw as readonly unknown[]).entries()) {
    const at = `filters[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `${at} doit être un objet`;
    }
    const keys = Object.keys(item);
    if (keys.some((k) => k !== "field" && k !== "op" && k !== "value")) {
      return `${at} : propriétés autorisées field, op, value`;
    }
    const { field, op, value } = item as Record<string, unknown>;
    if (typeof field !== "string" || !own(columns, field)) {
      return `${at} : champ non filtrable`;
    }
    const column = columns[field];
    const ops = allowedOps({
      kind: column.kind,
      nullable: column.whereNull !== undefined,
    });
    if (typeof op !== "string" || !ops.some((o) => o === op)) {
      return `${at} : opérateur non autorisé pour ${field}`;
    }
    const filterOp = op as ListFilterOp;
    if (NO_VALUE_OPS.includes(filterOp)) {
      if (value !== undefined) return `${at} : ${op} ne prend pas de valeur`;
      continue;
    }
    let error: string | null = null;
    if (column.kind === "text") {
      error =
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= MAX_FILTER_TEXT_LENGTH
          ? null
          : `attend un texte de 1 à ${MAX_FILTER_TEXT_LENGTH} caractères`;
    } else if (column.kind === "enum") {
      error =
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <= MAX_FILTER_ENUM_VALUES &&
        value.every((v) => typeof v === "string" && column.values.includes(v))
          ? null
          : "attend une liste de valeurs autorisées";
    } else {
      error = rangeValueError(column.kind, filterOp, value);
    }
    if (error) return `${at} (${field}) : ${error}`;
  }
  return null;
}

/**
 * Query-string value → parsed filters. A malformed JSON is kept as is: the
 * validator then refuses it (400) instead of the filter being dropped.
 */
export function parseListFiltersParam(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.trim() === "") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** `YYYY-MM-DD` of the next calendar day. */
function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1))
    .toISOString()
    .slice(0, 10);
}

/** Days are Paris days, like every date the back-office shows. */
const dayStart = (day: string): Date => parisStartOfDay(day);
const dayEnd = (day: string): Date => parisStartOfDay(nextDay(day));

function bounds(value: ListFilterValue | undefined): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new BadRequestException("Filtre invalide");
  }
  return [String(value[0]), String(value[1])];
}

// Every Prisma `where` input accepts `{ OR: [...] }` and `{ NOT: ... }` of
// itself: the only two places the generic needs telling.
const or = <Where>(list: Where[]): Where => ({ OR: list }) as unknown as Where;
const not = <Where>(where: Where): Where =>
  ({ NOT: where }) as unknown as Where;

function invalidOp(): never {
  throw new BadRequestException("Opérateur de filtre invalide");
}

function nullWhere<Where>(column: ColumnBase<Where>, op: ListFilterOp): Where {
  if (column.whereNull === undefined) return invalidOp();
  if (op === "isEmpty") return column.whereNull;
  if (op === "isNotEmpty") return not(column.whereNull);
  return invalidOp();
}

function textWhere<Where>(
  column: TextColumn<Where>,
  op: ListFilterOp,
  value: string,
): Where {
  const empty = (): Where =>
    column.whereNull !== undefined
      ? or([column.whereNull, column.where({ equals: "" })])
      : column.where({ equals: "" });
  switch (op) {
    case "contains":
      return column.where({ contains: value, mode: "insensitive" });
    case "startsWith":
      return column.where({ startsWith: value, mode: "insensitive" });
    case "equals":
      return column.where({ equals: value, mode: "insensitive" });
    case "notContains": {
      // SQL NOT drops NULL rows: a missing value does not contain the text.
      const without = not(
        column.where({ contains: value, mode: "insensitive" }),
      );
      return column.whereNull !== undefined
        ? or([column.whereNull, without])
        : without;
    }
    case "isEmpty":
      return empty();
    case "isNotEmpty":
      return not(empty());
    default:
      return invalidOp();
  }
}

function dateWhere<Where>(
  column: DateColumn<Where>,
  op: ListFilterOp,
  value: ListFilterValue | undefined,
): Where {
  switch (op) {
    case "lt":
      return column.where({ lt: dayStart(String(value)) });
    case "gt":
      return column.where({ gte: dayEnd(String(value)) });
    case "eq":
      return column.where({
        gte: dayStart(String(value)),
        lt: dayEnd(String(value)),
      });
    case "between": {
      const [from, to] = bounds(value);
      return column.where({ gte: dayStart(from), lt: dayEnd(to) });
    }
    default:
      return nullWhere(column, op);
  }
}

function numberWhere<Where>(
  column: NumberColumn<Where>,
  op: ListFilterOp,
  value: ListFilterValue | undefined,
): Where {
  switch (op) {
    case "lt":
      return column.where({ lt: Number(value) });
    case "gt":
      return column.where({ gt: Number(value) });
    case "eq":
      return column.where({ equals: Number(value) });
    case "between": {
      const [from, to] = bounds(value);
      return column.where({ gte: Number(from), lte: Number(to) });
    }
    default:
      return nullWhere(column, op);
  }
}

function enumWhere<Where>(
  column: EnumColumn<Where>,
  op: ListFilterOp,
  value: ListFilterValue | undefined,
): Where {
  if (op === "isEmpty") return nullWhere(column, op);
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException("Filtre invalide");
  }
  const oneOf = or(value.map((v) => column.where(String(v))));
  if (op === "in") return oneOf;
  if (op !== "notIn") return invalidOp();
  // Like « ne contient pas »: a row without value is none of them.
  return column.whereNull !== undefined
    ? or([column.whereNull, not(oneOf)])
    : not(oneOf);
}

/**
 * Prisma conditions of `filters`, to AND with the list's own where. Checks
 * again what the DTO validated: a service called without the pipe (a test, a
 * future caller) still never filters on a field outside the whitelist.
 */
export function listFiltersWhere<Where>(
  columns: FilterColumns<Where>,
  filters: readonly ListFilter[] | undefined,
): Where[] {
  if (!filters || filters.length === 0) return [];
  const error = listFiltersError(columns, filters);
  if (error) throw new BadRequestException(error);
  return filters.map((filter) => {
    const column = columns[filter.field];
    switch (column.kind) {
      case "text":
        return textWhere(column, filter.op, String(filter.value));
      case "date":
        return dateWhere(column, filter.op, filter.value);
      case "number":
        return numberWhere(column, filter.op, filter.value);
      case "enum":
        return enumWhere(column, filter.op, filter.value);
    }
  });
}

/** Field → kind (and values) of a whitelist: what the API docs and clients see. */
export function describeFilterColumns<Where>(
  columns: FilterColumns<Where>,
): string {
  return Object.entries(columns)
    .map(([field, column]) => {
      const ops = allowedOps({
        kind: column.kind,
        nullable: column.whereNull !== undefined,
      }).join("|");
      const values =
        column.kind === "enum" ? ` [${column.values.join(", ")}]` : "";
      return `${field} (${column.kind}${values} : ${ops})`;
    })
    .join(" ; ");
}
