import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import dayjs from 'dayjs';
import { useRef, useState } from 'react';
import {
  type ActiveFilter,
  describeFilter,
  type FilterFieldSpec,
  type FilterJoin,
  type FilterOp,
  type FilterSpecs,
  type FilterValue,
  isValidFilter,
  MAX_FIELD_CONDITIONS,
  MAX_FILTER_TEXT_LENGTH,
  MAX_FILTERS,
  needsValue,
  opLabel,
  opsFor,
  withFieldFilters,
  withoutCondition,
} from '../lib/listFilters';
import type { ColumnFilter } from './DataTable';

// Pickers inside a header menu keep their dropdown in the menu: a portal
// would count as a click outside and close it.
const IN_MENU = { withinPortal: false } as const;

const toDay = (value: string | Date | null): string | null =>
  value ? dayjs(value).format('YYYY-MM-DD') : null;

interface RangeProps {
  label: string;
  value: FilterValue | undefined;
  onChange: (value: FilterValue | undefined) => void;
}

/**
 * The bounds of a range are kept here while the admin fills them: the draft
 * only holds a complete pair (« Appliquer » stays off until then).
 */
function DateRangeInput({ label, value, onChange }: RangeProps) {
  const [range, setRange] = useState<[string | null, string | null]>(() =>
    Array.isArray(value) && value.length === 2
      ? [String(value[0]), String(value[1])]
      : [null, null],
  );
  return (
    <DatePickerInput
      type="range"
      aria-label={label}
      placeholder="Du… au…"
      valueFormat="DD/MM/YYYY"
      popoverProps={IN_MENU}
      value={range}
      onChange={([start, end]) => {
        const next: [string | null, string | null] = [toDay(start), toDay(end)];
        setRange(next);
        const [a, b] = next;
        onChange(a && b ? [a, b] : undefined);
      }}
    />
  );
}

function NumberRangeInput({ label, value, onChange }: RangeProps) {
  const [range, setRange] = useState<[number | undefined, number | undefined]>(() =>
    Array.isArray(value) && value.length === 2
      ? [Number(value[0]), Number(value[1])]
      : [undefined, undefined],
  );
  const bound = (index: 0 | 1, next: string | number) => {
    const pair: [number | undefined, number | undefined] = [...range];
    pair[index] = typeof next === 'number' ? next : undefined;
    setRange(pair);
    const [a, b] = pair;
    onChange(a !== undefined && b !== undefined ? [a, b] : undefined);
  };
  return (
    <Group gap="xs" grow>
      <NumberInput
        aria-label={`${label} (min)`}
        placeholder="Min"
        value={range[0] ?? ''}
        onChange={(v) => bound(0, v)}
      />
      <NumberInput
        aria-label={`${label} (max)`}
        placeholder="Max"
        value={range[1] ?? ''}
        onChange={(v) => bound(1, v)}
      />
    </Group>
  );
}

function ValueInput({
  spec,
  op,
  value,
  onChange,
  onSubmit,
  label,
}: {
  spec: FilterFieldSpec;
  op: FilterOp;
  value: FilterValue | undefined;
  onChange: (value: FilterValue | undefined) => void;
  onSubmit: () => void;
  /** Accessible name of the value. */
  label: string;
}) {
  switch (spec.kind) {
    case 'text':
      return (
        <TextInput
          aria-label={label}
          placeholder="Texte"
          maxLength={MAX_FILTER_TEXT_LENGTH}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          data-autofocus
        />
      );
    case 'enum': {
      const checked = Array.isArray(value) ? value.map(String) : [];
      return (
        <Checkbox.Group aria-label={label} value={checked} onChange={(v) => onChange(v)}>
          <ScrollArea.Autosize mah={220} type="auto">
            <Stack gap={6}>
              {(spec.options ?? []).map((o) => (
                <Checkbox key={o.value} value={o.value} label={o.label} />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Checkbox.Group>
      );
    }
    case 'date':
      if (op === 'between') {
        return <DateRangeInput label={label} value={value} onChange={onChange} />;
      }
      return (
        <DatePickerInput
          aria-label={label}
          placeholder="Date"
          valueFormat="DD/MM/YYYY"
          popoverProps={IN_MENU}
          value={typeof value === 'string' ? value : null}
          onChange={(day) => onChange(toDay(day) ?? undefined)}
        />
      );
    case 'number':
      if (op === 'between') {
        return <NumberRangeInput label={label} value={value} onChange={onChange} />;
      }
      return (
        <NumberInput
          aria-label={label}
          placeholder="Nombre"
          value={typeof value === 'number' ? value : ''}
          onChange={(v) => onChange(typeof v === 'number' ? v : undefined)}
        />
      );
  }
}

/** A condition being edited; `id` keeps its inputs when another one is removed. */
interface DraftCondition {
  id: number;
  op: FilterOp;
  value?: FilterValue;
}

const JOIN_LABELS: Record<FilterJoin, string> = { and: 'ET', or: 'OU' };

function ConditionEditor({
  spec,
  condition,
  index,
  onChange,
  onRemove,
  onSubmit,
}: {
  spec: FilterFieldSpec;
  condition: DraftCondition;
  index: number;
  onChange: (next: DraftCondition) => void;
  /** Absent on the only condition: « Retirer » removes the whole filter. */
  onRemove?: () => void;
  onSubmit: () => void;
}) {
  const ops = opsFor(spec);
  const { op, value } = condition;
  // The first condition keeps the names of #557; the others are numbered.
  const suffix = index === 0 ? '' : ` (condition ${index + 1})`;
  return (
    <Stack gap={6}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Select
          aria-label={`Opérateur : ${spec.label}${suffix}`}
          allowDeselect={false}
          comboboxProps={IN_MENU}
          data={ops.map((o) => ({ value: o, label: opLabel(spec.kind, o) }))}
          value={op}
          style={{ flex: 1 }}
          onChange={(next) => {
            const nextOp = ops.find((o) => o === next);
            if (!nextOp) return;
            // A single date or number does not carry over to a range, and back.
            const reset =
              (nextOp === 'between') !== (op === 'between') &&
              spec.kind !== 'enum' &&
              spec.kind !== 'text';
            onChange({ ...condition, op: nextOp, value: reset ? undefined : value });
          }}
        />
        {onRemove && (
          <ActionIcon
            variant="subtle"
            color="gray"
            mt={6}
            aria-label={`Supprimer la condition ${index + 1} : ${spec.label}`}
            onClick={onRemove}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </ActionIcon>
        )}
      </Group>
      {needsValue(op) && (
        <ValueInput
          spec={spec}
          op={op}
          value={value}
          label={`Valeur : ${spec.label}${suffix}`}
          onChange={(next) => onChange({ ...condition, value: next })}
          onSubmit={onSubmit}
        />
      )}
    </Stack>
  );
}

/**
 * Conditions of one column filter (#557, #673): an operator and a value each,
 * up to `maxConditions`, joined by an explicit ET / OU. The draft is applied
 * with « Appliquer » (or Enter in a text): typing does not query the API.
 */
export function ColumnFilterEditor<Field extends string>({
  field,
  spec,
  current,
  onChange,
  maxConditions = MAX_FIELD_CONDITIONS,
}: {
  field: Field;
  spec: FilterFieldSpec;
  /** The column's applied conditions; none when it is not filtered. */
  current: readonly ActiveFilter<Field>[];
  /** The new conditions of the column; none: its filter is removed. */
  onChange: (next: ActiveFilter<Field>[]) => void;
  maxConditions?: number;
}) {
  const ops = opsFor(spec);
  const nextId = useRef(current.length);
  const [conditions, setConditions] = useState<DraftCondition[]>(() =>
    current.length > 0
      ? current.map(({ op, value }, id) => ({ id, op, value }))
      : [{ id: 0, op: ops[0] }],
  );
  const [join, setJoin] = useState<FilterJoin>(current[0]?.join ?? 'and');
  const draft: ActiveFilter<Field>[] = conditions.map(({ op, value }) => ({
    field,
    op,
    ...(needsValue(op) && { value }),
    ...(conditions.length > 1 && join === 'or' && { join }),
  }));
  // Beyond the room left on the list (MAX_FILTERS in all), the API would refuse it.
  const tooMany = conditions.length > maxConditions;
  const atListCap = maxConditions < MAX_FIELD_CONDITIONS && conditions.length >= maxConditions;
  const valid = !tooMany && draft.every((condition) => isValidFilter(condition, spec));
  const apply = () => {
    if (valid) onChange(draft);
  };
  const update = (next: DraftCondition) =>
    setConditions((list) => list.map((c) => (c.id === next.id ? next : c)));
  const add = () => {
    const id = nextId.current + 1;
    nextId.current = id;
    setConditions((list) => [...list, { id, op: ops[0] }]);
  };

  return (
    <Stack gap="xs">
      {conditions.map((condition, index) => (
        <Stack key={condition.id} gap="xs">
          {index === 1 && (
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed" id={`join-${field}`}>
                Conditions reliées par
              </Text>
              <SegmentedControl
                size="xs"
                aria-labelledby={`join-${field}`}
                value={join}
                onChange={(next) => setJoin(next === 'or' ? 'or' : 'and')}
                data={(['and', 'or'] as const).map((value) => ({
                  value,
                  label: JOIN_LABELS[value],
                }))}
              />
            </Group>
          )}
          {index > 1 && (
            <Text size="xs" fw={700} c="dimmed">
              {JOIN_LABELS[join]}
            </Text>
          )}
          <ConditionEditor
            spec={spec}
            condition={condition}
            index={index}
            onChange={update}
            onRemove={
              conditions.length > 1
                ? () => setConditions((list) => list.filter((c) => c.id !== condition.id))
                : undefined
            }
            onSubmit={apply}
          />
        </Stack>
      ))}
      {atListCap && (
        <Text size="xs" c={tooMany ? 'red' : 'dimmed'}>
          {MAX_FILTERS} conditions au plus sur la liste : retirez-en une ailleurs pour en ajouter
          ici.
        </Text>
      )}
      <Group gap="xs" justify="space-between">
        <Button
          variant="subtle"
          size="xs"
          px={0}
          disabled={conditions.length >= maxConditions}
          aria-label={`Ajouter une condition : ${spec.label}`}
          onClick={add}
        >
          + Ajouter une condition
        </Button>
        <Group gap="xs">
          {current.length > 0 && (
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              aria-label={`Retirer le filtre : ${spec.label}`}
              onClick={() => onChange([])}
            >
              Retirer
            </Button>
          )}
          {/* On a phone every editor sits in one panel: the name says which one. */}
          <Button
            size="xs"
            disabled={!valid}
            aria-label={`Appliquer le filtre : ${spec.label}`}
            onClick={apply}
          >
            Appliquer
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/**
 * Header filters and chips of a list's operator filters: `filter(field)` is
 * the `filter` of its column, `chips` one per condition, each removable (the
 * conditions after the first of a column say how they join: « ou … »).
 */
export function operatorFilters<Field extends string>(
  specs: FilterSpecs<Field>,
  filters: readonly ActiveFilter<Field>[],
  setFilters: (next: ActiveFilter<Field>[]) => void,
): { filter: (field: Field) => ColumnFilter; chips: FilterChip[] } {
  return {
    filter: (field) => {
      const current = filters.filter((f) => f.field === field);
      // Room left under the API's bound on a whole list.
      const room = MAX_FILTERS - (filters.length - current.length);
      return {
        active: current.length > 0,
        content: (
          <ColumnFilterEditor
            // A new URL value (Back, a chip removed) resets the draft.
            key={current.length > 0 ? JSON.stringify(current) : 'none'}
            field={field}
            spec={specs[field]}
            current={current}
            maxConditions={Math.max(0, Math.min(MAX_FIELD_CONDITIONS, room))}
            onChange={(next) => setFilters(withFieldFilters(filters, field, next))}
          />
        ),
      };
    },
    chips: filters.map((f, index) => {
      const first = filters.findIndex((other) => other.field === f.field) === index;
      const description = describeFilter(f, specs[f.field]);
      return {
        key: `${f.field}-${index}`,
        label: first ? description : `${f.join === 'or' ? 'ou' : 'et'} ${description}`,
        onRemove: () => setFilters(withoutCondition(filters, index)),
      };
    }),
  };
}
