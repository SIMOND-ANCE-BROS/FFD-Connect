import { Checkbox } from '@mantine/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { vi } from 'vitest';
import { columnPrefsKey } from '../lib/columnPrefs';
import type { SortState } from '../lib/listSort';
import { columnFilterButton, openColumnFilter, sortButton } from '../test/dataTable';
import { renderWithProviders, setupUser } from '../test/render';
import { mockContainerWidth, mockPhoneViewport } from '../test/viewport';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  id: string;
  name: string;
  email: string;
  login: string;
}

const ROWS: Row[] = [
  { id: '1', name: 'Martin', email: 'm@x.fr', login: '01/10/2026' },
  { id: '2', name: 'Durand', email: 'd@x.fr', login: '02/10/2026' },
];

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{pathname + search}</p>;
}

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

function Harness({
  rows = ROWS,
  onSort = () => {},
  linked = false,
}: {
  rows?: Row[];
  onSort?: (sort: SortState | null) => void;
  /** Rows open `/rows/<id>` (#562). */
  linked?: boolean;
}) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [onlyActive, setOnlyActive] = useState(false);
  const columns: DataTableColumn<Row>[] = [
    { key: 'name', label: 'Nom', required: true, sortField: 'name', cell: (r) => r.name },
    {
      key: 'email',
      label: 'Email',
      cell: (r) => r.email,
      filter: {
        active: onlyActive,
        content: (
          <Checkbox
            label="Comptes actifs"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.currentTarget.checked)}
          />
        ),
      },
    },
    { key: 'login', label: 'Connexion', hiddenByDefault: true, cell: (r) => r.login },
  ];
  return (
    <>
      <LocationProbe />
      <DataTable
        tableId="test"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          onSort(next);
        }}
        onResetFilters={() => setOnlyActive(false)}
        rowHref={linked ? (r) => `/rows/${r.id}` : undefined}
        loading={false}
        empty={<p>Rien</p>}
        renderCard={(r) => <p>Carte {r.name}</p>}
      />
    </>
  );
}

let user: UserEvent;

describe('DataTable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = setupUser();
  });

  it('sorts from a header: ascending, descending, then the default order', async () => {
    const onSort = vi.fn();
    renderWithProviders(<Harness onSort={onSort} />);
    const header = screen.getByRole('columnheader', { name: /^Nom/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await user.click(sortButton('Nom'));
    expect(onSort).toHaveBeenLastCalledWith({ by: 'name', order: 'asc' });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await user.click(sortButton('Nom'));
    expect(onSort).toHaveBeenLastCalledWith({ by: 'name', order: 'desc' });
    expect(header).toHaveAttribute('aria-sort', 'descending');
    await user.click(sortButton('Nom'));
    expect(onSort).toHaveBeenLastCalledWith(null);
    expect(header).toHaveAttribute('aria-sort', 'none');
    // A column without sort field is plain text, with no aria-sort.
    expect(screen.getByRole('columnheader', { name: /Email/ })).not.toHaveAttribute('aria-sort');
  });

  it('sorts with the keyboard', async () => {
    const onSort = vi.fn();
    renderWithProviders(<Harness onSort={onSort} />);
    sortButton('Nom').focus();
    await user.keyboard('{Enter}');
    expect(onSort).toHaveBeenLastCalledWith({ by: 'name', order: 'asc' });
  });

  it('opens a header filter, flags it once active and resets every filter', async () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByLabelText('Comptes actifs')).toBeNull();
    await openColumnFilter(user, 'Email');
    await user.click(screen.getByLabelText('Comptes actifs'));
    expect(columnFilterButton('Email')).toHaveAccessibleName('Filtrer : Email (filtre actif)');
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres (1)' }));
    expect(columnFilterButton('Email')).toHaveAccessibleName('Filtrer : Email');
    expect(screen.queryByRole('button', { name: /Réinitialiser les filtres/ })).toBeNull();
  });

  it('keeps the headers, hence the filters, when nothing matches', () => {
    renderWithProviders(<Harness rows={[]} />);
    expect(headers()).toEqual(['Nom', 'Email']);
    expect(within(screen.getByRole('table')).getByText('Rien')).toBeInTheDocument();
  });

  it('shows and hides optional columns, never the identification one', async () => {
    renderWithProviders(<Harness />);
    expect(headers()).toEqual(['Nom', 'Email']);
    await user.click(screen.getByRole('button', { name: 'Colonnes' }));
    expect(screen.queryByRole('checkbox', { name: 'Nom' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Connexion' }));
    await user.click(screen.getByRole('checkbox', { name: 'Email' }));
    expect(headers()).toEqual(['Nom', 'Connexion']);
    expect(screen.getByText('01/10/2026')).toBeInTheDocument();
  });

  it('remembers the choice per table and restores the defaults on request', async () => {
    const first = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Colonnes' }));
    await user.click(screen.getByRole('checkbox', { name: 'Email' }));
    expect(JSON.parse(localStorage.getItem(columnPrefsKey('test')) ?? '{}')).toEqual({
      visible: { email: false },
    });
    first.unmount();

    renderWithProviders(<Harness />);
    expect(headers()).toEqual(['Nom']);
    await user.click(screen.getByRole('button', { name: 'Colonnes' }));
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les colonnes' }));
    expect(headers()).toEqual(['Nom', 'Email']);
    expect(localStorage.getItem(columnPrefsKey('test'))).toBeNull();
  });

  it('falls back to the default columns when the storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    renderWithProviders(<Harness />);
    expect(headers()).toEqual(['Nom', 'Email']);
    await user.click(screen.getByRole('button', { name: 'Colonnes' }));
    await user.click(screen.getByRole('checkbox', { name: 'Connexion' }));
    // Not remembered, but applied for this visit.
    expect(headers()).toEqual(['Nom', 'Email', 'Connexion']);
  });

  it('keeps a filtered column visible: its filter would be out of reach', async () => {
    renderWithProviders(<Harness />);
    await openColumnFilter(user, 'Email');
    await user.click(screen.getByLabelText('Comptes actifs'));
    await user.click(screen.getByRole('button', { name: 'Colonnes' }));
    expect(screen.getByRole('checkbox', { name: 'Email' })).toBeDisabled();
    expect(headers()).toContain('Email');
  });

  describe('rows open their record like a link (#562)', () => {
    it('opens the record on a plain click', async () => {
      renderWithProviders(<Harness linked />);
      await user.click(screen.getByText('d@x.fr'));
      expect(screen.getByTestId('location')).toHaveTextContent('/rows/2');
    });

    it('opens a new tab on Ctrl/Cmd-click and on the middle button', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      renderWithProviders(<Harness linked />);
      await user.keyboard('{Control>}');
      await user.click(screen.getByText('d@x.fr'));
      await user.keyboard('{/Control}');
      expect(open).toHaveBeenLastCalledWith('/rows/2', '_blank', 'noopener');
      await user.keyboard('{Meta>}');
      await user.click(screen.getByText('m@x.fr'));
      await user.keyboard('{/Meta}');
      expect(open).toHaveBeenLastCalledWith('/rows/1', '_blank', 'noopener');
      await user.pointer({ keys: '[MouseMiddle]', target: screen.getByText('d@x.fr') });
      expect(open).toHaveBeenCalledTimes(3);
      // The list stays where it was.
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    });

    it('leaves a click on a control of the row to that control', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      renderWithProviders(<Harness linked />);
      await user.click(sortButton('Nom'));
      await openColumnFilter(user, 'Email');
      expect(open).not.toHaveBeenCalled();
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    });
  });

  describe('fitting the width of the screen (#556)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps every chosen column when they fit, with no hidden-columns indicator', () => {
      mockContainerWidth(1200);
      renderWithProviders(<Harness />);
      expect(headers()).toEqual(['Nom', 'Email']);
      expect(screen.queryByRole('button', { name: /masquée/ })).toBeNull();
      expect(screen.getByRole('table')).toHaveClass('app-table-fit');
    });

    it('moves a column that does not fit into a detail row unfolded per line', async () => {
      mockContainerWidth(200);
      renderWithProviders(<Harness linked />);
      expect(headers()).toEqual(['Détail', 'Nom']);
      expect(screen.queryByText('m@x.fr')).toBeNull();

      const [first] = screen.getAllByRole('button', { name: 'Afficher le détail' });
      expect(first).toHaveAttribute('aria-expanded', 'false');
      await user.click(first);
      // Unfolding a line does not open the record.
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
      expect(first).toHaveAttribute('aria-expanded', 'true');
      expect(first).toHaveAccessibleName('Masquer le détail');
      expect(screen.getByText('m@x.fr')).toBeInTheDocument();
      expect(screen.queryByText('d@x.fr')).toBeNull();

      await user.click(first);
      expect(screen.queryByText('m@x.fr')).toBeNull();
    });

    it('lists the hidden columns, unfolds every line and keeps their filter in reach', async () => {
      mockContainerWidth(200);
      renderWithProviders(<Harness />);
      await user.click(screen.getByRole('button', { name: '1 colonne masquée' }));
      await user.click(screen.getByRole('button', { name: 'Déplier toutes les lignes' }));
      expect(screen.getByText('m@x.fr')).toBeInTheDocument();
      expect(screen.getByText('d@x.fr')).toBeInTheDocument();

      // Filtering on the hidden column brings it back into the table.
      await openColumnFilter(user, 'Email');
      await user.click(screen.getByLabelText('Comptes actifs'));
      expect(headers()).toEqual(['Nom', 'Email']);
    });

    it('respects the column choice: a column the admin hid never comes back', async () => {
      mockContainerWidth(200);
      renderWithProviders(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Colonnes' }));
      await user.click(screen.getByRole('checkbox', { name: 'Email' }));
      expect(headers()).toEqual(['Nom']);
      expect(screen.queryByRole('button', { name: /masquée/ })).toBeNull();
    });

    it('shows the full value of a cut cell on hover', async () => {
      renderWithProviders(<Harness />);
      const cell = screen.getByText('m@x.fr');
      Object.defineProperty(cell, 'scrollWidth', { configurable: true, value: 300 });
      Object.defineProperty(cell, 'clientWidth', { configurable: true, value: 100 });
      await user.hover(cell);
      expect(cell).toHaveAttribute('title', 'm@x.fr');
      Object.defineProperty(cell, 'scrollWidth', { configurable: true, value: 100 });
      await user.unhover(cell);
      await user.hover(cell);
      expect(cell).not.toHaveAttribute('title');
    });
  });

  describe('resizing columns (#670)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const handle = (column: string) =>
      screen.getByRole('separator', { name: `Redimensionner la colonne ${column}` });
    const colWidths = () =>
      Array.from(screen.getByRole('table').querySelectorAll('col')).map((c) => c.style.width);
    const stored = () => JSON.parse(localStorage.getItem(columnPrefsKey('test')) ?? '{}');

    it('resizes with the keyboard, remembers the width and lets the table scroll', async () => {
      mockContainerWidth(1000);
      renderWithProviders(<Harness />);
      expect(screen.getByRole('table').parentElement).not.toHaveClass('app-table-scroll');
      handle('Email').focus();
      // Unmeasured header in jsdom: the column starts from its minimum (110 px).
      await user.keyboard('{ArrowRight}');
      expect(handle('Email')).toHaveAttribute('aria-valuenow', '120');
      await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
      expect(stored()).toEqual({ widths: { email: 170 } });
      expect(colWidths()).toEqual(['830px', '170px']);
      expect(screen.getByRole('table').parentElement).toHaveClass('app-table-scroll');
    });

    it('resizes by dragging the edge of a header, without sorting', async () => {
      const onSort = vi.fn();
      renderWithProviders(<Harness onSort={onSort} />);
      const edge = handle('Nom');
      fireEvent.pointerDown(edge, { button: 0, clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(edge, { clientX: 190, pointerId: 1 });
      // Not remembered until released.
      expect(localStorage.getItem(columnPrefsKey('test'))).toBeNull();
      fireEvent.pointerUp(edge, { clientX: 230, pointerId: 1 });
      expect(stored()).toEqual({ widths: { name: 240 } });
      await user.click(edge);
      expect(onSort).not.toHaveBeenCalled();
    });

    it('fits a column to its content on a double-click or Enter', async () => {
      renderWithProviders(<Harness />);
      const cell = screen.getByText('m@x.fr');
      Object.defineProperty(cell, 'scrollWidth', { configurable: true, value: 260 });
      await user.dblClick(handle('Email'));
      expect(stored()).toEqual({ widths: { email: 260 } });
      Object.defineProperty(cell, 'scrollWidth', { configurable: true, value: 180 });
      handle('Email').focus();
      await user.keyboard('{Enter}');
      expect(stored()).toEqual({ widths: { email: 180 } });
    });

    it('restores the widths with the columns, back to fitting the screen', async () => {
      localStorage.setItem(columnPrefsKey('test'), JSON.stringify({ widths: { email: 400 } }));
      renderWithProviders(<Harness />);
      expect(colWidths()).toContain('400px');
      await user.click(screen.getByRole('button', { name: 'Colonnes' }));
      await user.click(screen.getByRole('button', { name: 'Réinitialiser les colonnes' }));
      expect(colWidths()).not.toContain('400px');
      expect(localStorage.getItem(columnPrefsKey('test'))).toBeNull();
    });
  });

  describe('reordering columns (#671)', () => {
    it('moves a column from the picker with the keyboard, focus following it', async () => {
      renderWithProviders(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Colonnes' }));
      expect(screen.getByRole('button', { name: 'Monter la colonne Nom' })).toBeDisabled();
      const up = screen.getByRole('button', { name: 'Monter la colonne Email' });
      up.focus();
      await user.keyboard('{Enter}');
      expect(headers()).toEqual(['Email', 'Nom']);
      // At the top: the focus moves to the button still usable.
      expect(screen.getByRole('button', { name: 'Descendre la colonne Email' })).toHaveFocus();
      expect(JSON.parse(localStorage.getItem(columnPrefsKey('test')) ?? '{}')).toEqual({
        order: ['email', 'name', 'login'],
      });
    });

    it('moves a column by dragging its header onto another one', () => {
      renderWithProviders(<Harness />);
      const [name, email] = screen.getAllByRole('columnheader');
      const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
      fireEvent.dragStart(email, { dataTransfer });
      fireEvent.dragOver(name, { dataTransfer });
      expect(name).toHaveClass('app-th-drop-before');
      fireEvent.drop(name, { dataTransfer });
      expect(headers()).toEqual(['Email', 'Nom']);
      expect(screen.getAllByRole('columnheader')[0]).not.toHaveClass('app-th-drop-before');
    });

    it('keeps the order after a reload and restores the default on request', async () => {
      localStorage.setItem(
        columnPrefsKey('test'),
        JSON.stringify({ order: ['login', 'email', 'name'], visible: { login: true } }),
      );
      renderWithProviders(<Harness />);
      expect(headers()).toEqual(['Connexion', 'Email', 'Nom']);
      // The cells follow their header.
      const firstRow = screen.getAllByRole('row')[1];
      expect(within(firstRow).getAllByRole('cell')[0]).toHaveTextContent('01/10/2026');
      await user.click(screen.getByRole('button', { name: 'Colonnes' }));
      await user.click(screen.getByRole('button', { name: 'Réinitialiser les colonnes' }));
      expect(headers()).toEqual(['Nom', 'Email']);
    });
  });

  describe('row selection (#558)', () => {
    function Selectable({ full = false, linked = false }: { full?: boolean; linked?: boolean }) {
      const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
      return (
        <DataTable
          tableId="select"
          columns={[{ key: 'name', label: 'Nom', required: true, cell: (r: Row) => r.name }]}
          rows={[...ROWS, { id: '3', name: 'Petit', email: 'p@x.fr', login: '' }]}
          rowKey={(r) => r.id}
          sort={null}
          onSortChange={() => {}}
          rowHref={linked ? (r) => `/rows/${r.id}` : undefined}
          loading={false}
          empty={<p>Rien</p>}
          renderCard={(r) => <p>Carte {r.name}</p>}
          selection={{
            isSelected: (r) => picked.has(r.id),
            // Petit is already linked.
            isSelectable: (r) => r.id !== '3',
            onChange: (rows, selected) =>
              setPicked((prev) => {
                const next = new Set(prev);
                for (const r of rows) {
                  if (selected) next.add(r.id);
                  else next.delete(r.id);
                }
                return next;
              }),
            label: (r) => `Sélectionner ${r.name}`,
            disabledLabel: (r) => `${r.name} : déjà membre`,
            full,
          }}
        />
      );
    }

    it('ticks rows one by one without opening them, and the whole page at once', async () => {
      renderWithProviders(
        <>
          <Selectable linked />
          <LocationProbe />
        </>,
      );
      const page = screen.getByRole('checkbox', { name: 'Tout sélectionner sur la page' });
      await user.click(screen.getByRole('checkbox', { name: 'Sélectionner Martin' }));
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
      expect(page).not.toBeChecked();
      expect(page).toHaveAttribute('data-indeterminate', 'true');

      await user.click(page);
      expect(page).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Sélectionner Durand' })).toBeChecked();
      // A row that cannot be selected stays out, flagged by its name.
      expect(screen.getByRole('checkbox', { name: 'Petit : déjà membre' })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: 'Petit : déjà membre' })).not.toBeChecked();

      await user.click(page);
      expect(screen.getByRole('checkbox', { name: 'Sélectionner Martin' })).not.toBeChecked();
    });

    it('stops new ticks once the selection is full', () => {
      renderWithProviders(<Selectable full />);
      expect(screen.getByRole('checkbox', { name: 'Sélectionner Martin' })).toBeDisabled();
      expect(
        screen.getByRole('checkbox', { name: 'Tout sélectionner sur la page' }),
      ).toBeDisabled();
    });

    it('puts a checkbox next to each card on a phone', async () => {
      mockPhoneViewport();
      renderWithProviders(<Selectable />);
      expect(screen.getByText('Carte Martin')).toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: 'Sélectionner Martin' }));
      expect(screen.getByRole('checkbox', { name: 'Sélectionner Martin' })).toBeChecked();
    });
  });

  describe('on a phone', () => {
    beforeEach(() => mockPhoneViewport());

    it('shows cards, a sort select and the folded filters, without the column picker', async () => {
      const onSort = vi.fn();
      renderWithProviders(<Harness onSort={onSort} />);
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.getByText('Carte Martin')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Colonnes' })).toBeNull();

      await user.click(screen.getByRole('textbox', { name: 'Trier par' }));
      await user.click(screen.getByRole('option', { name: 'Nom (décroissant)' }));
      expect(onSort).toHaveBeenLastCalledWith({ by: 'name', order: 'desc' });

      const toggle = screen.getByRole('button', { name: 'Filtres' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await user.click(screen.getByLabelText('Comptes actifs'));
      expect(screen.getByRole('button', { name: 'Filtres (1)' })).toBeInTheDocument();
    });
  });
});
