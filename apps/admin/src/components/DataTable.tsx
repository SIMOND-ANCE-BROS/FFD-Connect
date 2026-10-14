import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  CloseButton,
  Collapse,
  Group,
  Paper,
  Popover,
  Select,
  Stack,
  Table,
  Text,
  UnstyledButton,
  VisuallyHidden,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Fragment, useId, useState, type MouseEvent, type ReactNode } from 'react';
import {
  type ColumnPrefs,
  type ColumnVisibility,
  isColumnVisible,
  loadColumnPrefs,
  saveColumnPrefs,
} from '../lib/columnPrefs';
import { nextSort, type SortOrder, type SortState } from '../lib/listSort';
import { DEFAULT_MIN_WIDTH, fitColumns } from '../lib/tableFit';
import { useContainerWidth } from '../lib/useContainerWidth';
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
  /** Narrowest readable width, in px (#556). Default: {@link DEFAULT_MIN_WIDTH}. */
  minWidth?: number;
  /** Relative share of the spare width (1 by default): 2 = twice as wide as a 1. */
  weight?: number;
  /**
   * Importance when the screen is too narrow for every column: the highest
   * numbers move into the detail row first. Default: the column's position.
   */
  priority?: number;
  /** Multi-line content (a change summary…): wraps instead of being cut with « … ». */
  wrap?: boolean;
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
  /** Active filters shown above the rows, each removable in one click (#557). */
  filterChips?: { key: string; label: string; onRemove: () => void }[];
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

function FilterMenu({
  label,
  filter,
  inMenu = false,
}: {
  label: string;
  filter: ColumnFilter;
  /** Opened from another menu: no portal, or a click in it would close that menu. */
  inMenu?: boolean;
}) {
  return (
    <Popover
      position="bottom-start"
      shadow="md"
      withArrow
      trapFocus
      returnFocus
      withinPortal={!inMenu}
    >
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

/** Sort button (or plain label) and filter funnel of a column: in its header, or in the hidden-columns menu. */
function HeaderControls<Row>({
  column,
  sort,
  onSortChange,
  inMenu = false,
}: {
  column: DataTableColumn<Row>;
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
  inMenu?: boolean;
}) {
  const { sortField } = column;
  const order = sortField && sort?.by === sortField ? sort.order : null;
  return (
    <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
      {sortField ? (
        <UnstyledButton
          onClick={() => onSortChange(nextSort(sort, sortField))}
          fz="sm"
          fw={700}
          style={{ minWidth: 0 }}
          title={`${column.label} — ${
            order === 'asc'
              ? 'trier par ordre décroissant'
              : order === 'desc'
                ? "revenir à l'ordre par défaut"
                : 'trier par ordre croissant'
          }`}
        >
          <Group gap={4} wrap="nowrap" component="span" style={{ minWidth: 0 }}>
            <span className="app-truncate">{column.label}</span>
            <SortIcon order={order} />
          </Group>
        </UnstyledButton>
      ) : (
        <Text component="span" fz="sm" fw={700} className="app-truncate" title={column.label}>
          {column.label}
        </Text>
      )}
      {column.filter && <FilterMenu label={column.label} filter={column.filter} inMenu={inMenu} />}
    </Group>
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
    <Table.Th aria-sort={sortField ? ariaSort : undefined}>
      <HeaderControls column={column} sort={sort} onSortChange={onSortChange} />
    </Table.Th>
  );
}

/**
 * Full value of a cut cell on hover (#556): the native tooltip is set only
 * when the text overflows, from what the cell renders.
 */
function showFullValue(event: MouseEvent<HTMLElement>) {
  const cell = event.currentTarget;
  if (cell.scrollWidth > cell.clientWidth) {
    cell.title = (cell.textContent ?? '').trim();
  } else {
    cell.removeAttribute('title');
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }}
    >
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * « N colonnes masquées »: the columns that did not fit, with their sort and
 * filter (their header is gone) and a switch unfolding every row.
 */
function HiddenColumnsMenu<Row>({
  columns,
  sort,
  onSortChange,
  allExpanded,
  onToggleAll,
}: {
  columns: DataTableColumn<Row>[];
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
  allExpanded: boolean;
  onToggleAll: () => void;
}) {
  const count = columns.length;
  return (
    <Popover position="bottom-start" shadow="md" withArrow trapFocus returnFocus>
      <Popover.Target>
        <Button variant="subtle" size="compact-sm">
          {count} colonne{count > 1 ? 's' : ''} masquée{count > 1 ? 's' : ''}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" miw={220} maw={320}>
          <Text size="sm">
            Faute de place, {count > 1 ? 'ces colonnes sont' : 'cette colonne est'} dans le détail
            de chaque ligne (flèche en début de ligne).
          </Text>
          {columns.map((c) => (
            <HeaderControls key={c.key} column={c} sort={sort} onSortChange={onSortChange} inMenu />
          ))}
          <Button variant="light" size="xs" onClick={onToggleAll}>
            {allExpanded ? 'Replier toutes les lignes' : 'Déplier toutes les lignes'}
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
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
 * Shared back-office list (#443, #444, #556). Clicking a sortable header sorts
 * the whole (server-side) list ascending, descending, then back to the
 * default; the funnel of a header opens its filter. « Colonnes » shows or
 * hides the optional columns, remembered per table in this browser. The table
 * always fits the width of the screen: columns share it by weight, long values
 * are cut with « … » (full value on hover), and when their minimum widths do
 * not fit, the least important columns move into a detail row unfolded per
 * line. On a phone the rows become cards, with the sort and every filter in a
 * folded panel.
 */
export function DataTable<Row>({
  tableId,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  onResetFilters,
  filterChips = [],
  onRowClick,
  renderCard,
  toolbar,
  summary,
  loading,
  error,
  empty,
}: DataTableProps<Row>) {
  const isMobile = useIsMobile();
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => loadColumnPrefs(tableId));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
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

  // The columns the admin chose (#444), fitted to the width of the screen (#556).
  const fit = fitColumns(
    visible.map((c, index) => ({
      key: c.key,
      minWidth: c.minWidth ?? DEFAULT_MIN_WIDTH,
      weight: c.weight ?? 1,
      priority: c.priority ?? index,
      // Its header carries the active filter or sort: it stays in view.
      pinned:
        Boolean(c.required) ||
        Boolean(c.filter?.active) ||
        (c.sortField !== undefined && sort?.by === c.sortField),
    })),
    containerWidth,
  );
  const shown = visible.filter((c) => fit.shown.includes(c.key));
  const hidden = visible.filter((c) => fit.hidden.includes(c.key));
  const withDetail = hidden.length > 0;
  const allExpanded = rows.length > 0 && rows.every((row) => expanded.has(rowKey(row)));
  const toggleRow = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(rows.map((row) => rowKey(row))));

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
    const colSpan = shown.length + (withDetail ? 1 : 0);
    body = (
      <>
        {(summary || withDetail) && (
          <Group gap="sm" align="center">
            {summary}
            {withDetail && (
              <HiddenColumnsMenu
                columns={hidden}
                sort={sort}
                onSortChange={onSortChange}
                allExpanded={allExpanded}
                onToggleAll={toggleAll}
              />
            )}
          </Group>
        )}
        <Box className="app-table-surface">
          <Table striped highlightOnHover className="app-table-fit">
            <colgroup>
              {withDetail && <col style={{ width: fit.expanderWidth ?? undefined }} />}
              {shown.map((c) => (
                <col key={c.key} style={{ width: fit.widths[c.key] }} />
              ))}
            </colgroup>
            <Table.Thead>
              <Table.Tr>
                {withDetail && (
                  <Table.Th>
                    <VisuallyHidden>Détail</VisuallyHidden>
                  </Table.Th>
                )}
                {shown.map((c) => (
                  <HeaderCell key={c.key} column={c} sort={sort} onSortChange={onSortChange} />
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={colSpan} className="app-cell-wrap">
                    {empty}
                  </Table.Td>
                </Table.Tr>
              ) : (
                rows.map((row) => {
                  const key = rowKey(row);
                  const open = withDetail && expanded.has(key);
                  const detailId = `${tableId}-detail-${key}`;
                  return (
                    <Fragment key={key}>
                      <Table.Tr
                        className={onRowClick ? 'app-row-link' : undefined}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                      >
                        {withDetail && (
                          <Table.Td>
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              size="sm"
                              aria-label={open ? 'Masquer le détail' : 'Afficher le détail'}
                              aria-expanded={open}
                              aria-controls={open ? detailId : undefined}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleRow(key);
                              }}
                            >
                              <ChevronIcon open={open} />
                            </ActionIcon>
                          </Table.Td>
                        )}
                        {shown.map((c) => (
                          <Table.Td
                            key={c.key}
                            className={c.wrap ? 'app-cell-wrap' : 'app-cell-truncate'}
                            onMouseEnter={c.wrap ? undefined : showFullValue}
                          >
                            {c.cell(row)}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                      {open && (
                        <Table.Tr id={detailId} className="app-row-detail">
                          <Table.Td colSpan={colSpan} className="app-cell-wrap">
                            <Group gap="lg" align="flex-start" pl={44}>
                              {hidden.map((c) => (
                                <Stack key={c.key} gap={2} miw={0} maw="100%">
                                  <Text size="xs" c="dimmed" fw={600}>
                                    {c.label}
                                  </Text>
                                  <Box fz="sm">{c.cell(row)}</Box>
                                </Stack>
                              ))}
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </Table.Tbody>
          </Table>
        </Box>
      </>
    );
  }

  return (
    <Stack ref={containerRef}>
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
      {filterChips.length > 0 && (
        <Group gap="xs" aria-label="Filtres actifs" role="group">
          {filterChips.map((chip) => (
            // Mantine's Pill hides its remove button from assistive tech: a real button here.
            <Badge
              key={chip.key}
              size="lg"
              variant="light"
              tt="none"
              fw={500}
              maw="100%"
              rightSection={
                <CloseButton
                  size="xs"
                  variant="transparent"
                  aria-label={`Retirer le filtre : ${chip.label}`}
                  onClick={chip.onRemove}
                />
              }
            >
              {chip.label}
            </Badge>
          ))}
        </Group>
      )}
      {body}
    </Stack>
  );
}
