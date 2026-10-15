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
import { type NavigateFunction, useNavigate } from 'react-router';
import {
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  clampColumnWidth,
  type ColumnPrefs,
  type ColumnVisibility,
  DEFAULT_COLUMN_PREFS,
  dropKey,
  isColumnVisible,
  isDefaultColumnPrefs,
  loadColumnPrefs,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveKey,
  orderColumns,
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
  /**
   * Record page a row opens (#562): a click anywhere on the row goes there,
   * Ctrl/Cmd/Shift-click and the middle button open it in a new tab, like a
   * link. The row must also render a real link to it (keyboard, screen reader).
   */
  rowHref?: (row: Row) => string | null;
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
  /** Checkbox per row, kept by the caller across pages and searches (#558). */
  selection?: RowSelection<Row>;
}

/**
 * Row selection of a DataTable (#558). The table only shows the checkboxes:
 * the caller owns the selected set, so it survives pages, sorts and filters.
 */
export interface RowSelection<Row> {
  isSelected: (row: Row) => boolean;
  /** False: the checkbox is shown disabled (an account already linked…). */
  isSelectable: (row: Row) => boolean;
  /** Tick or untick `rows` (one row, or the selectable rows of the page). */
  onChange: (rows: Row[], selected: boolean) => void;
  /** Accessible name of a row's checkbox, e.g. « Sélectionner Anna Petit ». */
  label: (row: Row) => string;
  /** Accessible name of a disabled checkbox, e.g. « Anna Petit : déjà membre ». */
  disabledLabel?: (row: Row) => string;
  /** The selection is full: unticked rows can no longer be ticked. */
  full?: boolean;
}

/** Width of the checkbox column, in px. */
const SELECT_WIDTH = 44;

function RowCheckbox<Row>({ row, selection }: { row: Row; selection: RowSelection<Row> }) {
  const selected = selection.isSelected(row);
  const selectable = selection.isSelectable(row);
  return (
    <Checkbox
      checked={selected}
      disabled={!selectable || (Boolean(selection.full) && !selected)}
      aria-label={
        selectable ? selection.label(row) : (selection.disabledLabel ?? selection.label)(row)
      }
      // A ticked row is not opened.
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => selection.onChange([row], event.currentTarget.checked)}
    />
  );
}

/** « Tout sélectionner » of the rows shown, ticked when every selectable one is. */
function PageCheckbox<Row>({ rows, selection }: { rows: Row[]; selection: RowSelection<Row> }) {
  const selectable = rows.filter(selection.isSelectable);
  const ticked = selectable.filter(selection.isSelected);
  const all = selectable.length > 0 && ticked.length === selectable.length;
  return (
    <Checkbox
      aria-label="Tout sélectionner sur la page"
      checked={all}
      indeterminate={ticked.length > 0 && !all}
      disabled={selectable.length === 0 || (Boolean(selection.full) && !all)}
      onChange={() =>
        selection.onChange(all ? ticked : selectable.filter((r) => !selection.isSelected(r)), !all)
      }
    />
  );
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

/** Keyboard step of a column resize, in px (Shift: {@link RESIZE_BIG_STEP}). */
const RESIZE_STEP = 10;
const RESIZE_BIG_STEP = 50;

/**
 * Width a column needs to show its cells uncut (#670): what overflows each
 * cell, its own or that of a cut label inside (a header's).
 */
export function naturalWidth(cell: HTMLElement): number {
  let width = cell.scrollWidth;
  cell.querySelectorAll<HTMLElement>('.app-truncate').forEach((inner) => {
    width += Math.max(0, inner.scrollWidth - inner.clientWidth);
  });
  return width;
}

interface ResizeProps {
  /** Current width in px, measured from the header when not set by hand. */
  width: (header: HTMLElement | null) => number;
  /** `persist`: the drag or the key press is over, the width is remembered. */
  onResize: (width: number, persist: boolean) => void;
  onAutofit: () => void;
  onDragging: (dragging: boolean) => void;
}

/**
 * Edge of a header that resizes its column (#670): drag it, or focus it and
 * use the arrows (Shift: bigger steps); a double-click or Enter fits the
 * column to its content. The window-splitter pattern of WAI-ARIA.
 */
function ResizeHandle({
  label,
  width,
  onResize,
  onAutofit,
  onDragging,
}: ResizeProps & { label: string }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const header = (element: HTMLElement) => element.closest('th');

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const initial = width(header(event.currentTarget));
    start.current = { x: event.clientX, width: initial };
    setCurrent(initial);
    onDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const resizeTo = (event: PointerEvent<HTMLDivElement>, persist: boolean) => {
    if (!start.current) return;
    const next = clampColumnWidth(start.current.width + event.clientX - start.current.x);
    setCurrent(next);
    onResize(next, persist);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    resizeTo(event, true);
    start.current = null;
    onDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onAutofit();
      return;
    }
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    const step = event.shiftKey ? RESIZE_BIG_STEP : RESIZE_STEP;
    const next = clampColumnWidth(width(header(event.currentTarget)) + direction * step);
    setCurrent(next);
    onResize(next, true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Redimensionner la colonne ${label}`}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuenow={current ?? undefined}
      aria-valuetext={current === null ? undefined : `${current} px`}
      title="Glisser pour redimensionner, double-clic pour ajuster au contenu"
      tabIndex={0}
      className="app-col-resize"
      draggable={false}
      onFocus={(event) => setCurrent(width(header(event.currentTarget)))}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => resizeTo(event, false)}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // A click on the edge neither sorts nor opens anything.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onAutofit();
      }}
      onKeyDown={onKeyDown}
    />
  );
}

/** Where a dragged header would land (#671). */
interface DropTarget {
  key: string;
  side: 'before' | 'after';
}

interface HeaderDragProps {
  dropSide: DropTarget['side'] | null;
  onStart: (event: DragEvent<HTMLElement>) => void;
  onOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onEnd: () => void;
}

/** Type of the data a dragged header carries. */
const COLUMN_DRAG_TYPE = 'application/x-ffd-column';

function HeaderCell<Row>({
  column,
  sort,
  onSortChange,
  resize,
  drag,
}: {
  column: DataTableColumn<Row>;
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
  resize: ResizeProps;
  drag: HeaderDragProps;
}) {
  const { sortField } = column;
  const order = sortField && sort?.by === sortField ? sort.order : null;
  const ariaSort = order === 'asc' ? 'ascending' : order === 'desc' ? 'descending' : 'none';
  return (
    <Table.Th
      aria-sort={sortField ? ariaSort : undefined}
      data-col={column.key}
      className={drag.dropSide ? `app-th app-th-drop-${drag.dropSide}` : 'app-th'}
      draggable
      onDragStart={drag.onStart}
      onDragOver={drag.onOver}
      onDrop={drag.onDrop}
      onDragEnd={drag.onEnd}
    >
      <HeaderControls column={column} sort={sort} onSortChange={onSortChange} />
      <ResizeHandle label={column.label} {...resize} />
    </Table.Th>
  );
}

/**
 * Full value of a cut cell on hover (#556): the native tooltip is set only
 * when the text overflows, from what the cell renders.
 */
/** Controls of a row that handle their own clicks: a link, a checkbox, a button… */
const INTERACTIVE = 'a, button, input, label, select, textarea, [role="button"], [role="checkbox"]';

/**
 * Click on a row with a record page (#562), with the behaviour of a link:
 * plain click → same tab; Ctrl/Cmd/Shift-click or middle button → new tab. A
 * click on a link, checkbox or button inside the row is left to it (a link
 * already does all of this natively).
 */
export function openRow(event: MouseEvent<HTMLElement>, href: string, navigate: NavigateFunction) {
  if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
  // Only the main and the middle buttons open a row.
  if (event.button !== 0 && event.button !== 1) return;
  if (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey) {
    event.preventDefault();
    window.open(href, '_blank', 'noopener');
    return;
  }
  navigate(href);
}

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

function ArrowIcon({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d={up ? 'M6 2 10.5 7.5h-9z' : 'M6 10 1.5 4.5h9z'} fill="currentColor" />
    </svg>
  );
}

/**
 * « Colonnes »: which columns are shown (#444) and in which order (#671),
 * with « Monter » / « Descendre » buttons usable from the keyboard.
 * « Réinitialiser les colonnes » restores the default choice, order and
 * widths (#670).
 */
function ColumnPicker<Row>({
  columns,
  isVisible,
  onToggle,
  onMove,
  onReset,
  canReset,
}: {
  /** Every column, in the order displayed. */
  columns: DataTableColumn<Row>[];
  isVisible: (column: DataTableColumn<Row>) => boolean;
  onToggle: (column: DataTableColumn<Row>, visible: boolean) => void;
  onMove: (column: DataTableColumn<Row>, delta: -1 | 1) => void;
  onReset: () => void;
  canReset: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [moved, setMoved] = useState<{ key: string; up: boolean } | null>(null);
  // A moved row is rendered elsewhere: the focus follows its button (the
  // other one once it reached an end).
  useEffect(() => {
    if (!moved) return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[data-move-key]') ?? [],
    ).filter((b) => b.dataset.moveKey === moved.key && !b.disabled);
    const same = buttons.find((b) => b.dataset.moveUp === String(moved.up));
    (same ?? buttons[0])?.focus();
    setMoved(null);
  }, [moved]);
  if (columns.length < 2 && !canReset) return null;
  const move = (c: DataTableColumn<Row>, up: boolean) => {
    onMove(c, up ? -1 : 1);
    setMoved({ key: c.key, up });
  };
  return (
    <Popover position="bottom-end" shadow="md" withArrow trapFocus returnFocus>
      <Popover.Target>
        <Button variant="default">Colonnes</Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" miw={240} maw={360} ref={listRef}>
          <Text size="sm" fw={600}>
            Colonnes affichées
          </Text>
          {columns.map((c, index) => (
            <Group key={c.key} gap="xs" wrap="nowrap" justify="space-between">
              {c.required ? (
                <Text size="sm" title="Toujours affichée">
                  {c.label}
                </Text>
              ) : (
                <Checkbox
                  label={c.label}
                  checked={isVisible(c)}
                  // A filtered column stays visible: its filter would be out of reach.
                  disabled={c.filter?.active}
                  description={c.filter?.active ? 'Filtre actif' : undefined}
                  onChange={(e) => onToggle(c, e.currentTarget.checked)}
                />
              )}
              <Group gap={2} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Monter la colonne ${c.label}`}
                  data-move-key={c.key}
                  data-move-up="true"
                  disabled={index === 0}
                  onClick={() => move(c, true)}
                >
                  <ArrowIcon up />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Descendre la colonne ${c.label}`}
                  data-move-key={c.key}
                  data-move-up="false"
                  disabled={index === columns.length - 1}
                  onClick={() => move(c, false)}
                >
                  <ArrowIcon up={false} />
                </ActionIcon>
              </Group>
            </Group>
          ))}
          <Text size="xs" c="dimmed">
            Glissez un en-tête pour déplacer la colonne, ou son bord droit pour changer sa largeur
            (double-clic : ajuster au contenu).
          </Text>
          <Button variant="subtle" size="xs" onClick={onReset} disabled={!canReset}>
            Réinitialiser les colonnes
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
 * hides the optional columns and reorders them; a header is also dragged to
 * move its column (#671) and its right edge to resize it (#670). These
 * choices are remembered per table in this browser. By default the table fits
 * the width of the screen: columns share it by weight, long values are cut
 * with « … » (full value on hover), and when their minimum widths do not fit,
 * the least important columns move into a detail row unfolded per line. Once a
 * column is resized by hand, the table keeps those widths and scrolls
 * horizontally if it has to. On a phone the rows become cards, with the sort
 * and every filter in a folded panel.
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
  rowHref,
  renderCard,
  toolbar,
  summary,
  loading,
  error,
  empty,
  selection,
}: DataTableProps<Row>) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => loadColumnPrefs(tableId));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const tableRef = useRef<HTMLTableElement>(null);
  const resizing = useRef(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const activeFilters = columns.filter((c) => c.filter?.active).length;

  const isVisible = (c: DataTableColumn<Row>) =>
    isColumnVisible(c, prefs) || Boolean(c.filter?.active);
  /** `persist` false: a drag in progress, remembered once the header edge is released. */
  const changePrefs = (update: (current: ColumnPrefs) => ColumnPrefs, persist = true) =>
    setPrefs((current) => {
      const next = update(current);
      if (persist) saveColumnPrefs(tableId, next);
      return next;
    });
  const toggleColumn = (c: DataTableColumn<Row>, shown: boolean) =>
    changePrefs((current) => {
      const choice = { ...current.visible };
      // Only a choice that differs from the default is kept.
      if (shown === !c.hiddenByDefault) delete choice[c.key];
      else choice[c.key] = shown;
      return { ...current, visible: choice };
    });

  // Every column in the order the admin chose (#671): headers, picker, detail row, phone panel.
  const ordered = orderColumns(columns, prefs.order);
  const orderKeys = ordered.map((c) => c.key);
  const moveColumn = (c: DataTableColumn<Row>, delta: -1 | 1) =>
    changePrefs((current) => ({ ...current, order: moveKey(orderKeys, c.key, delta) }));
  const setWidth = (key: string, width: number, persist: boolean) =>
    changePrefs(
      (current) => ({ ...current, widths: { ...current.widths, [key]: clampColumnWidth(width) } }),
      persist,
    );
  const autofit = (key: string) => {
    const cells = Array.from(
      tableRef.current?.querySelectorAll<HTMLElement>('[data-col]') ?? [],
    ).filter((cell) => cell.dataset.col === key);
    setWidth(key, Math.max(0, ...cells.map(naturalWidth)), true);
  };
  /** Width of a column now: the one set by hand, else its header's, else its minimum. */
  const widthOf = (c: DataTableColumn<Row>, header: HTMLElement | null) =>
    prefs.widths[c.key] ??
    (Math.round(header?.getBoundingClientRect().width ?? 0) || (c.minWidth ?? DEFAULT_MIN_WIDTH));

  const clearDrag = () => {
    setDragged(null);
    setDropTarget(null);
  };
  const dragProps = (c: DataTableColumn<Row>): HeaderDragProps => ({
    dropSide: dropTarget?.key === c.key ? dropTarget.side : null,
    onStart: (event) => {
      // Dragging the edge resizes the column: it does not move it.
      if (resizing.current) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(COLUMN_DRAG_TYPE, c.key);
      setDragged(c.key);
    },
    onOver: (event) => {
      if (!dragged || dragged === c.key) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const box = event.currentTarget.getBoundingClientRect();
      const side = event.clientX > box.left + box.width / 2 ? 'after' : 'before';
      if (dropTarget?.key !== c.key || dropTarget.side !== side) {
        setDropTarget({ key: c.key, side });
      }
    },
    onDrop: (event) => {
      event.preventDefault();
      if (dragged && dragged !== c.key) {
        const side = dropTarget?.key === c.key ? dropTarget.side : 'before';
        const source = dragged;
        changePrefs((current) => ({ ...current, order: dropKey(orderKeys, source, c.key, side) }));
      }
      clearDrag();
    },
    onEnd: clearDrag,
  });

  const visible = ordered.filter(isVisible);
  const manualWidths: Record<string, number> = {};
  for (const c of visible) {
    const width = prefs.widths[c.key];
    if (width !== undefined) manualWidths[c.key] = width;
  }

  // The columns the admin chose (#444), fitted to the width of the screen (#556)
  // unless some were resized by hand (#670).
  const fit = fitColumns(
    visible.map((c) => ({
      key: c.key,
      minWidth: c.minWidth ?? DEFAULT_MIN_WIDTH,
      weight: c.weight ?? 1,
      // Importance follows the declaration of the columns, not the order shown.
      priority: c.priority ?? columns.indexOf(c),
      // Its header carries the active filter or sort: it stays in view.
      pinned:
        Boolean(c.required) ||
        Boolean(c.filter?.active) ||
        (c.sortField !== undefined && sort?.by === c.sortField),
    })),
    containerWidth,
    selection ? SELECT_WIDTH : 0,
    manualWidths,
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
            {rows.map((row) =>
              selection ? (
                <Group key={rowKey(row)} gap="sm" wrap="nowrap" align="center">
                  <RowCheckbox row={row} selection={selection} />
                  <Box style={{ flex: 1, minWidth: 0 }}>{renderCard(row)}</Box>
                </Group>
              ) : (
                <Fragment key={rowKey(row)}>{renderCard(row)}</Fragment>
              ),
            )}
          </RecordList>
        )}
      </>
    );
  } else {
    const colSpan = shown.length + (withDetail ? 1 : 0) + (selection ? 1 : 0);
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
        <Box
          className={
            fit.tableWidth === null ? 'app-table-surface' : 'app-table-surface app-table-scroll'
          }
        >
          <Table
            striped
            highlightOnHover
            className="app-table-fit"
            ref={tableRef}
            style={
              fit.tableWidth === null ? undefined : { width: fit.tableWidth, minWidth: '100%' }
            }
          >
            <colgroup>
              {selection && <col style={{ width: fit.reservedWidth }} />}
              {withDetail && <col style={{ width: fit.expanderWidth ?? undefined }} />}
              {shown.map((c) => (
                <col key={c.key} style={{ width: fit.widths[c.key] }} />
              ))}
            </colgroup>
            <Table.Thead>
              <Table.Tr>
                {selection && (
                  <Table.Th>
                    <PageCheckbox rows={rows} selection={selection} />
                  </Table.Th>
                )}
                {withDetail && (
                  <Table.Th>
                    <VisuallyHidden>Détail</VisuallyHidden>
                  </Table.Th>
                )}
                {shown.map((c) => (
                  <HeaderCell
                    key={c.key}
                    column={c}
                    sort={sort}
                    onSortChange={onSortChange}
                    resize={{
                      width: (header) => widthOf(c, header),
                      onResize: (width, persist) => setWidth(c.key, width, persist),
                      onAutofit: () => autofit(c.key),
                      onDragging: (dragging) => {
                        resizing.current = dragging;
                      },
                    }}
                    drag={dragProps(c)}
                  />
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
                  const href = rowHref?.(row) ?? null;
                  return (
                    <Fragment key={key}>
                      <Table.Tr
                        className={href ? 'app-row-link' : undefined}
                        onClick={href ? (event) => openRow(event, href, navigate) : undefined}
                        onAuxClick={href ? (event) => openRow(event, href, navigate) : undefined}
                      >
                        {selection && (
                          <Table.Td>
                            <RowCheckbox row={row} selection={selection} />
                          </Table.Td>
                        )}
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
                            data-col={c.key}
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
                columns={ordered}
                isVisible={isVisible}
                onToggle={toggleColumn}
                onMove={moveColumn}
                onReset={() => changePrefs(() => DEFAULT_COLUMN_PREFS)}
                canReset={!isDefaultColumnPrefs(prefs)}
              />
            )}
          </Group>
        </Group>
      )}
      {isMobile && (
        <PhoneControls
          columns={ordered}
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
