import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  Paper,
  Popover,
  Select,
  Stack,
  Table,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Fragment, useId, useState, type ReactNode } from 'react';
import {
  type ColumnPrefs,
  type ColumnVisibility,
  isColumnVisible,
  loadColumnPrefs,
  saveColumnPrefs,
} from '../lib/columnPrefs';
import { nextSort, type SortOrder, type SortState } from '../lib/listSort';
import { useIsMobile } from '../lib/useIsMobile';
import { ListSkeleton } from './ListStates';
import { RecordList } from './RecordCard';

export interface ColumnFilter {
  /** A value narrows the list: the header icon is highlighted and counted. */
  active: boolean;
  /** The filter control(s), shown in the header menu (in the « Filtres » panel on a phone). */
  content: ReactNode;
}

export interface DataTableColumn<Row> extends ColumnVisibility {
  label: string;
  cell: (row: Row) => ReactNode;
  /** API sort field: the header becomes a sort button. */
  sortField?: string;
  filter?: ColumnFilter;
  nowrap?: boolean;
}

interface DataTableProps<Row> {
  /** Key of the column choice in the browser storage: one per list. */
  tableId: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
  /** Clears every column filter (the search, always visible, is not one). */
  onResetFilters?: () => void;
  onRowClick?: (row: Row) => void;
  /** Phone layout of a row: a card, as tables do not fit. */
  renderCard: (row: Row) => ReactNode;
  /** Above the table, next to the column picker (search input…). */
  toolbar?: ReactNode;
  /** Total line shown above the rows once loaded. */
  summary?: ReactNode;
  loading: boolean;
  /** Message of a failed load: replaces the rows. */
  error?: ReactNode;
  empty: ReactNode;
  minWidth?: number;
}

const SORT_LABELS: Record<SortOrder, string> = { asc: 'croissant', desc: 'décroissant' };

function SortIcon({ order }: { order: SortOrder | null }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M6 1.5 9 5H3z" fill="currentColor" opacity={order === 'asc' ? 1 : 0.3} />
      <path d="M6 10.5 3 7h6z" fill="currentColor" opacity={order === 'desc' ? 1 : 0.3} />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2 3h12l-4.5 5.2V13l-3-1.5V8.2z" fill="currentColor" />
    </svg>
  );
}

function FilterMenu({ label, filter }: { label: string; filter: ColumnFilter }) {
  return (
    <Popover position="bottom-start" shadow="md" withArrow trapFocus returnFocus>
      <Popover.Target>
        <ActionIcon
          size="sm"
          variant={filter.active ? 'filled' : 'subtle'}
          color={filter.active ? undefined : 'gray'}
          aria-label={filter.active ? `Filtrer : ${label} (filtre actif)` : `Filtrer : ${label}`}
        >
          <FilterIcon />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" miw={220} maw={320}>
          <Text size="sm" fw={600}>
            {label}
          </Text>
          {filter.content}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function HeaderCell<Row>({
  column,
  sort,
  onSortChange,
}: {
  column: DataTableColumn<Row>;
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
}) {
  const { sortField } = column;
  const order = sortField && sort?.by === sortField ? sort.order : null;
  const ariaSort = order === 'asc' ? 'ascending' : order === 'desc' ? 'descending' : 'none';
  return (
    <Table.Th aria-sort={sortField ? ariaSort : undefined} style={{ whiteSpace: 'nowrap' }}>
      <Group gap={4} wrap="nowrap">
        {sortField ? (
          <UnstyledButton
            onClick={() => onSortChange(nextSort(sort, sortField))}
            fz="sm"
            fw={700}
            title={
              order === 'asc'
                ? 'Trier par ordre décroissant'
                : order === 'desc'
                  ? "Revenir à l'ordre par défaut"
                  : 'Trier par ordre croissant'
            }
          >
            <Group gap={4} wrap="nowrap" component="span">
              {column.label}
              <SortIcon order={order} />
            </Group>
          </UnstyledButton>
        ) : (
          column.label
        )}
        {column.filter && <FilterMenu label={column.label} filter={column.filter} />}
      </Group>
    </Table.Th>
  );
}

function ColumnPicker<Row>({
  columns,
  isVisible,
  onToggle,
  onReset,
}: {
  columns: DataTableColumn<Row>[];
  isVisible: (column: DataTableColumn<Row>) => boolean;
  onToggle: (column: DataTableColumn<Row>, visible: boolean) => void;
  onReset: () => void;
}) {
  const optional = columns.filter((c) => !c.required);
  if (optional.length === 0) return null;
  return (
    <Popover position="bottom-end" shadow="md" withArrow trapFocus returnFocus>
      <Popover.Target>
        <Button variant="default">Colonnes</Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" miw={220}>
          <Text size="sm" fw={600}>
            Colonnes affichées
          </Text>
          {optional.map((c) => (
            <Checkbox
              key={c.key}
              label={c.label}
              checked={isVisible(c)}
              // A filtered column stays visible: its filter would be out of reach.
              disabled={c.filter?.active}
              description={c.filter?.active ? 'Filtre actif' : undefined}
              onChange={(e) => onToggle(c, e.currentTarget.checked)}
            />
          ))}
          <Button variant="subtle" size="xs" onClick={onReset}>
            Colonnes par défaut
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function PhoneControls<Row>({
  columns,
  sort,
  onSortChange,
  activeFilters,
}: {
  columns: DataTableColumn<Row>[];
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
  activeFilters: number;
}) {
  const [opened, { toggle }] = useDisclosure(false);
  const panelId = useId();
  const sortOptions = columns.flatMap((c) =>
    c.sortField
      ? (['asc', 'desc'] as const).map((order) => ({
          value: `${c.sortField}:${order}`,
          label: `${c.label} (${SORT_LABELS[order]})`,
        }))
      : [],
  );
  const filtered = columns.filter((c) => c.filter);
  if (sortOptions.length === 0 && filtered.length === 0) return null;
  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="wrap" align="flex-end">
        {sortOptions.length > 0 && (
          <Select
            label="Trier par"
            placeholder="Ordre par défaut"
            clearable
            data={sortOptions}
            value={sort ? `${sort.by}:${sort.order}` : null}
            onChange={(value) => {
              if (!value) return onSortChange(null);
              const [by, order] = value.split(':');
              onSortChange({ by, order: order === 'desc' ? 'desc' : 'asc' });
            }}
            style={{ flex: 1, minWidth: 200 }}
          />
        )}
        {filtered.length > 0 && (
          <Button
            variant={activeFilters > 0 ? 'light' : 'default'}
            onClick={toggle}
            aria-expanded={opened}
            aria-controls={panelId}
          >
            {activeFilters > 0 ? `Filtres (${activeFilters})` : 'Filtres'}
          </Button>
        )}
      </Group>
      <Collapse in={opened} id={panelId}>
        <Paper withBorder p="sm">
          <Stack gap="md">
            {filtered.map((c) => (
              <Stack key={c.key} gap={4}>
                <Text size="sm" fw={600}>
                  {c.label}
                </Text>
                {c.filter?.content}
              </Stack>
            ))}
          </Stack>
        </Paper>
      </Collapse>
    </Stack>
  );
}

/**
 * Shared back-office list (#443, #444). Clicking a sortable header sorts the
 * whole (server-side) list ascending, descending, then back to the default;
 * the funnel of a header opens its filter. « Colonnes » shows or hides the
 * optional columns, remembered per table in this browser. On a phone the rows
 * become cards, with the sort and every filter in a folded panel.
 */
export function DataTable<Row>({
  tableId,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  onResetFilters,
  onRowClick,
  renderCard,
  toolbar,
  summary,
  loading,
  error,
  empty,
  minWidth = 720,
}: DataTableProps<Row>) {
  const isMobile = useIsMobile();
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => loadColumnPrefs(tableId));
  const activeFilters = columns.filter((c) => c.filter?.active).length;

  const isVisible = (c: DataTableColumn<Row>) =>
    isColumnVisible(c, prefs) || Boolean(c.filter?.active);
  const updatePrefs = (next: ColumnPrefs) => {
    setPrefs(next);
    saveColumnPrefs(tableId, next);
  };
  const toggleColumn = (c: DataTableColumn<Row>, visible: boolean) => {
    const next = { ...prefs };
    // Only a choice that differs from the default is kept.
    if (visible === !c.hiddenByDefault) delete next[c.key];
    else next[c.key] = visible;
    updatePrefs(next);
  };
  const visible = columns.filter(isVisible);

  const resetButton = onResetFilters && activeFilters > 0 && (
    <Button variant="subtle" onClick={onResetFilters}>
      Réinitialiser les filtres ({activeFilters})
    </Button>
  );

  let body: ReactNode;
  if (error) {
    body = <Alert color="red">{error}</Alert>;
  } else if (loading) {
    body = <ListSkeleton />;
  } else if (isMobile) {
    body = (
      <>
        {summary}
        {rows.length === 0 ? (
          empty
        ) : (
          <RecordList>
            {rows.map((row) => (
              <Fragment key={rowKey(row)}>{renderCard(row)}</Fragment>
            ))}
          </RecordList>
        )}
      </>
    );
  } else {
    body = (
      <>
        {summary}
        <Table.ScrollContainer minWidth={minWidth}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                {visible.map((c) => (
                  <HeaderCell key={c.key} column={c} sort={sort} onSortChange={onSortChange} />
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={visible.length}>{empty}</Table.Td>
                </Table.Tr>
              ) : (
                rows.map((row) => (
                  <Table.Tr
                    key={rowKey(row)}
                    className={onRowClick ? 'app-row-link' : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {visible.map((c) => (
                      <Table.Td key={c.key} style={c.nowrap ? { whiteSpace: 'nowrap' } : undefined}>
                        {c.cell(row)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </>
    );
  }

  return (
    <Stack>
      {(toolbar || resetButton || !isMobile) && (
        <Group justify="space-between" align="flex-end" gap="sm" wrap="wrap">
          <Box style={{ flex: 1, minWidth: 0 }}>{toolbar}</Box>
          <Group gap="xs">
            {resetButton}
            {!isMobile && (
              <ColumnPicker
                columns={columns}
                isVisible={isVisible}
                onToggle={toggleColumn}
                onReset={() => updatePrefs({})}
              />
            )}
          </Group>
        </Group>
      )}
      {isMobile && (
        <PhoneControls
          columns={columns}
          sort={sort}
          onSortChange={onSortChange}
          activeFilters={activeFilters}
        />
      )}
      {body}
    </Stack>
  );
}
