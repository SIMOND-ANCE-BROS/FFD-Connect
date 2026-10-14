import {
  Button,
  Checkbox,
  Group,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  TextInput,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import dayjs from 'dayjs';
import { useState } from 'react';
import {
  type ActiveFilter,
  describeFilter,
  type FilterFieldSpec,
  type FilterOp,
  type FilterSpecs,
  type FilterValue,
  isValidFilter,
  MAX_FILTER_TEXT_LENGTH,
  needsValue,
  opLabel,
  opsFor,
  withFilter,
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
}: {
  spec: FilterFieldSpec;
  op: FilterOp;
  value: FilterValue | undefined;
  onChange: (value: FilterValue | undefined) => void;
  onSubmit: () => void;
}) {
  const label = `Valeur : ${spec.label}`;
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

/**
 * Operator + value of one column filter (#557). The draft is applied with
 * « Appliquer » (or Enter in a text): typing does not query the API.
 */
export function ColumnFilterEditor<Field extends string>({
  field,
  spec,
  current,
  onChange,
}: {
  field: Field;
  spec: FilterFieldSpec;
  current: ActiveFilter<Field> | undefined;
  onChange: (next: ActiveFilter<Field> | null) => void;
}) {
  const ops = opsFor(spec);
  const [op, setOp] = useState<FilterOp>(current?.op ?? ops[0]);
  const [value, setValue] = useState<FilterValue | undefined>(current?.value);
  const draft: ActiveFilter<Field> = needsValue(op) ? { field, op, value } : { field, op };
  const valid = isValidFilter(draft, spec);
  const apply = () => {
    if (valid) onChange(draft);
  };

  return (
    <Stack gap="xs">
      <Select
        aria-label={`Opérateur : ${spec.label}`}
        allowDeselect={false}
        comboboxProps={IN_MENU}
        data={ops.map((o) => ({ value: o, label: opLabel(spec.kind, o) }))}
        value={op}
        onChange={(next) => {
          const nextOp = ops.find((o) => o === next);
          if (!nextOp) return;
          // A single date or number does not carry over to a range, and back.
          if (
            (nextOp === 'between') !== (op === 'between') &&
            spec.kind !== 'enum' &&
            spec.kind !== 'text'
          ) {
            setValue(undefined);
          }
          setOp(nextOp);
        }}
      />
      {needsValue(op) && (
        <ValueInput spec={spec} op={op} value={value} onChange={setValue} onSubmit={apply} />
      )}
      <Group gap="xs" justify="flex-end">
        {current && (
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            aria-label={`Retirer le filtre : ${spec.label}`}
            onClick={() => onChange(null)}
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
 * the `filter` of its column, `chips` the active filters, each removable.
 */
export function operatorFilters<Field extends string>(
  specs: FilterSpecs<Field>,
  filters: readonly ActiveFilter<Field>[],
  setFilters: (next: ActiveFilter<Field>[]) => void,
): { filter: (field: Field) => ColumnFilter; chips: FilterChip[] } {
  const update = (field: Field, next: ActiveFilter<Field> | null) =>
    setFilters(withFilter(filters, field, next));
  return {
    filter: (field) => {
      const current = filters.find((f) => f.field === field);
      return {
        active: current !== undefined,
        content: (
          <ColumnFilterEditor
            // A new URL value (Back, a chip removed) resets the draft.
            key={current ? JSON.stringify(current) : 'none'}
            field={field}
            spec={specs[field]}
            current={current}
            onChange={(next) => update(field, next)}
          />
        ),
      };
    },
    chips: filters.map((f) => ({
      key: f.field,
      label: describeFilter(f, specs[f.field]),
      onRemove: () => update(f.field, null),
    })),
  };
}
