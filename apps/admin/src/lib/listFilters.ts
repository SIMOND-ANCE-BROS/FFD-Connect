import dayjs from 'dayjs';
import type { ListFilterOp } from '../api/generated/types.gen';

/**
 * Column filters with operators (#557). Each list declares its filterable
 * fields (the API's whitelist: the generated `…FilterDto['field']` union);
 * active filters live in the URL as `f.<field>=<op>[:<value>]` and go to the
 * API as the `filters` JSON parameter, where they are applied server-side and
 * combined with AND.
 */

export type FilterOp = ListFilterOp;
export type FilterKind = 'text' | 'date' | 'number' | 'enum';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterFieldSpec {
  /** Column label, reused by the active-filter chips. */
  label: string;
  kind: FilterKind;
  /** The value can be missing: offers « est vide » on dates, numbers and lists. */
  nullable?: boolean;
  /** Values of an `enum` field. */
  options?: readonly FilterOption[];
}

export type FilterSpecs<Field extends string> = Readonly<Record<Field, FilterFieldSpec>>;

export type FilterValue = string | number | string[] | number[];

export interface ActiveFilter<Field extends string = string> {
  field: Field;
  op: FilterOp;
  /** Absent for « est vide » / « n'est pas vide ». */
  value?: FilterValue;
}

/** Same bounds as the API (400 beyond). */
export const MAX_FILTER_TEXT_LENGTH = 100;
export const MAX_FILTERS = 10;

const TEXT_OPS: readonly FilterOp[] = [
  'contains',
  'notContains',
  'equals',
  'startsWith',
  'isEmpty',
  'isNotEmpty',
];
const RANGE_OPS: readonly FilterOp[] = ['lt', 'gt', 'eq', 'between', 'isEmpty', 'isNotEmpty'];
const ENUM_OPS: readonly FilterOp[] = ['in', 'notIn', 'isEmpty'];
const NO_VALUE: readonly FilterOp[] = ['isEmpty', 'isNotEmpty'];

/** Operators of a field, in menu order: « est vide » only where a value can be missing. */
export function opsFor(spec: FilterFieldSpec): readonly FilterOp[] {
  if (spec.kind === 'text') return TEXT_OPS;
  const ops = spec.kind === 'enum' ? ENUM_OPS : RANGE_OPS;
  return spec.nullable ? ops : ops.filter((op) => !NO_VALUE.includes(op));
}

export const needsValue = (op: FilterOp): boolean => !NO_VALUE.includes(op);

const OP_LABELS: Record<FilterKind, Partial<Record<FilterOp, string>>> = {
  text: {
    contains: 'contient',
    notContains: 'ne contient pas',
    equals: 'est égal à',
    startsWith: 'commence par',
    isEmpty: 'est vide',
    isNotEmpty: "n'est pas vide",
  },
  date: {
    lt: 'avant le',
    gt: 'après le',
    eq: 'le',
    between: 'entre',
    isEmpty: 'est vide',
    isNotEmpty: "n'est pas vide",
  },
  number: {
    lt: 'inférieur à',
    gt: 'supérieur à',
    eq: 'égal à',
    between: 'entre',
    isEmpty: 'est vide',
    isNotEmpty: "n'est pas vide",
  },
  enum: { in: "est l'une de", notIn: "n'est aucune de", isEmpty: 'est vide' },
};

export const opLabel = (kind: FilterKind, op: FilterOp): string => OP_LABELS[kind][op] ?? op;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (value: unknown): value is string =>
  typeof value === 'string' && DAY.test(value) && dayjs(value).format('YYYY-MM-DD') === value;
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** True when `filter` is complete and acceptable for `spec` (what the API checks too). */
export function isValidFilter(filter: ActiveFilter, spec: FilterFieldSpec): boolean {
  if (!opsFor(spec).includes(filter.op)) return false;
  const { op, value } = filter;
  if (!needsValue(op)) return value === undefined;
  switch (spec.kind) {
    case 'text':
      return (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        value.length <= MAX_FILTER_TEXT_LENGTH
      );
    case 'enum': {
      const allowed = (spec.options ?? []).map((o) => o.value);
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((v) => typeof v === 'string' && allowed.includes(v))
      );
    }
    case 'date':
    case 'number': {
      const isPoint = spec.kind === 'date' ? isDay : isNumber;
      if (op !== 'between') return isPoint(value);
      if (!Array.isArray(value) || value.length !== 2) return false;
      const [from, to] = value;
      return isPoint(from) && isPoint(to) && from <= to;
    }
  }
}

const PREFIX = 'f.';

function parseValue(spec: FilterFieldSpec, op: FilterOp, raw: string): FilterValue | undefined {
  if (spec.kind === 'text') return raw;
  if (spec.kind === 'enum') return raw.split(',').filter(Boolean);
  // Number('') is 0: an empty bound must stay invalid.
  const toNumber = (part: string) => (part.trim() === '' ? Number.NaN : Number(part));
  if (op === 'between') {
    const parts = raw.split(',');
    return spec.kind === 'number' ? parts.map(toNumber) : parts;
  }
  return spec.kind === 'number' ? toNumber(raw) : raw;
}

/** Filters kept in the URL (`f.email=contains:marie`, `f.club=isEmpty`); invalid ones are dropped. */
export function readFilters<Field extends string>(
  params: URLSearchParams,
  specs: FilterSpecs<Field>,
): ActiveFilter<Field>[] {
  const filters: ActiveFilter<Field>[] = [];
  const fields = Object.keys(specs) as Field[];
  for (const [key, raw] of params.entries()) {
    if (!key.startsWith(PREFIX)) continue;
    const field = fields.find((f) => f === key.slice(PREFIX.length));
    if (!field || filters.some((f) => f.field === field)) continue;
    const spec = specs[field];
    const colon = raw.indexOf(':');
    const op = opsFor(spec).find((o) => o === (colon === -1 ? raw : raw.slice(0, colon)));
    if (!op || needsValue(op) !== (colon !== -1)) continue;
    const filter: ActiveFilter<Field> = needsValue(op)
      ? { field, op, value: parseValue(spec, op, raw.slice(colon + 1)) }
      : { field, op };
    if (isValidFilter(filter, spec)) filters.push(filter);
    if (filters.length === MAX_FILTERS) break;
  }
  return filters;
}

/** Writes `filters` into `params`, one `f.<field>` each. */
export function writeFilters(params: URLSearchParams, filters: readonly ActiveFilter[]): void {
  for (const { field, op, value } of filters) {
    const encoded = Array.isArray(value) ? value.join(',') : value;
    params.set(`${PREFIX}${field}`, encoded === undefined ? op : `${op}:${encoded}`);
  }
}

/** `filters` parameter of the API, or nothing without filter. */
export function filtersQuery(filters: readonly ActiveFilter[]): { filters?: string } {
  if (filters.length === 0) return {};
  return {
    filters: JSON.stringify(
      filters.map(({ field, op, value }) =>
        value === undefined ? { field, op } : { field, op, value },
      ),
    ),
  };
}

/** The list with `next` for its field (or without it when null). */
export function withFilter<Field extends string>(
  filters: readonly ActiveFilter<Field>[],
  field: Field,
  next: ActiveFilter<Field> | null,
): ActiveFilter<Field>[] {
  const others = filters.filter((f) => f.field !== field);
  return next ? [...others, next] : others;
}

const formatDay = (day: string) => dayjs(day).format('DD/MM/YYYY');

function formatValue(spec: FilterFieldSpec, op: FilterOp, value: FilterValue | undefined): string {
  if (value === undefined) return '';
  if (spec.kind === 'text') return `« ${String(value)} »`;
  if (spec.kind === 'enum') {
    const labels = new Map((spec.options ?? []).map((o) => [o.value, o.label]));
    return (Array.isArray(value) ? value : [value])
      .map((v) => labels.get(String(v)) ?? String(v))
      .join(', ');
  }
  const point = (v: string | number) => (spec.kind === 'date' ? formatDay(String(v)) : String(v));
  if (op === 'between' && Array.isArray(value)) {
    return `${point(value[0])} et ${point(value[1])}`;
  }
  return point(Array.isArray(value) ? value[0] : value);
}

/** Readable sentence of a filter, for its chip: « Email contient « marie » ». */
export function describeFilter(filter: ActiveFilter, spec: FilterFieldSpec): string {
  const value = formatValue(spec, filter.op, filter.value);
  return [spec.label, opLabel(spec.kind, filter.op), value].filter(Boolean).join(' ');
}
