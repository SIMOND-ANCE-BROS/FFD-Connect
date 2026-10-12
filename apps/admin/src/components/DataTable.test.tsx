import { Checkbox } from '@mantine/core';
import { screen, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';
import { columnPrefsKey } from '../lib/columnPrefs';
import type { SortState } from '../lib/listSort';
import { columnFilterButton, openColumnFilter, sortButton } from '../test/dataTable';
import { renderWithProviders, setupUser } from '../test/render';
import { mockPhoneViewport } from '../test/viewport';
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

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

function Harness({
  rows = ROWS,
  onSort = () => {},
  onRowClick,
}: {
  rows?: Row[];
  onSort?: (sort: SortState | null) => void;
  onRowClick?: (row: Row) => void;
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
      onRowClick={onRowClick}
      loading={false}
      empty={<p>Rien</p>}
      renderCard={(r) => <p>Carte {r.name}</p>}
    />
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
    const header = screen.getByRole('columnheader', { name: 'Nom' });
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
      email: false,
    });
    first.unmount();

    renderWithProviders(<Harness />);
    expect(headers()).toEqual(['Nom']);
    await user.click(screen.getByRole('button', { name: 'Colonnes' }));
    await user.click(screen.getByRole('button', { name: 'Colonnes par défaut' }));
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

  it('opens a row on click', async () => {
    const onRowClick = vi.fn();
    renderWithProviders(<Harness onRowClick={onRowClick} />);
    await user.click(screen.getByText('d@x.fr'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
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
