import { screen } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import type { ActiveFilter, FilterSpecs } from '../lib/listFilters';
import { fill, pickOption, renderWithProviders, setupUser } from '../test/render';
import { ColumnFilterEditor, operatorFilters } from './ColumnFilterEditor';

const BPM = { label: 'MPM', kind: 'number' } as const;
const LOGIN = { label: 'Connexion', kind: 'date', nullable: true } as const;
const EMAIL = { label: 'Email', kind: 'text' } as const;

describe('ColumnFilterEditor (#557)', () => {
  it('applies a number range only once both bounds are set', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    renderWithProviders(
      <ColumnFilterEditor field="bpm" spec={BPM} current={[]} onChange={onChange} />,
    );
    await pickOption(user, screen.getByRole('textbox', { name: 'Opérateur : MPM' }), 'entre');
    const apply = screen.getByRole('button', { name: 'Appliquer le filtre : MPM' });
    await fill(user, screen.getByRole('textbox', { name: 'Valeur : MPM (min)' }), '28');
    expect(apply).toBeDisabled();
    await fill(user, screen.getByRole('textbox', { name: 'Valeur : MPM (max)' }), '31');
    await user.click(apply);
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'bpm', op: 'between', value: [28, 31] }]);
  });

  it('applies « est vide » without a value, and removes the current filter', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    renderWithProviders(
      <ColumnFilterEditor
        field="login"
        spec={LOGIN}
        current={[{ field: 'login', op: 'lt', value: '2026-10-14' }]}
        onChange={onChange}
      />,
    );
    await pickOption(
      user,
      screen.getByRole('textbox', { name: 'Opérateur : Connexion' }),
      'est vide',
    );
    expect(screen.queryByRole('textbox', { name: 'Valeur : Connexion' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Appliquer le filtre : Connexion' }));
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'login', op: 'isEmpty' }]);
    await user.click(screen.getByRole('button', { name: 'Retirer le filtre : Connexion' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('several conditions on one column (#673)', () => {
  it('joins two text conditions with OU', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    renderWithProviders(
      <ColumnFilterEditor field="email" spec={EMAIL} current={[]} onChange={onChange} />,
    );
    await fill(user, screen.getByRole('textbox', { name: 'Valeur : Email' }), 'gmail');
    // No join to choose with a single condition.
    expect(screen.queryByRole('radio', { name: 'OU' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ajouter une condition : Email' }));
    const apply = screen.getByRole('button', { name: 'Appliquer le filtre : Email' });
    // The new condition is empty: nothing to apply yet.
    expect(apply).toBeDisabled();
    await fill(
      user,
      screen.getByRole('textbox', { name: 'Valeur : Email (condition 2)' }),
      'hotmail',
    );
    await user.click(screen.getByRole('radio', { name: 'OU' }));
    await user.click(apply);
    expect(onChange).toHaveBeenLastCalledWith([
      { field: 'email', op: 'contains', value: 'gmail', join: 'or' },
      { field: 'email', op: 'contains', value: 'hotmail', join: 'or' },
    ]);
  });

  it('edits the applied conditions with ET, removes one and stops at the cap', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    renderWithProviders(
      <ColumnFilterEditor
        field="email"
        spec={EMAIL}
        maxConditions={3}
        current={[
          { field: 'email', op: 'startsWith', value: 'a' },
          { field: 'email', op: 'notContains', value: 'test' },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: 'ET' })).toBeChecked();
    const add = screen.getByRole('button', { name: 'Ajouter une condition : Email' });
    await user.click(add);
    expect(add).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Supprimer la condition 3 : Email' }));
    expect(add).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Appliquer le filtre : Email' }));
    expect(onChange).toHaveBeenLastCalledWith([
      { field: 'email', op: 'startsWith', value: 'a' },
      { field: 'email', op: 'notContains', value: 'test' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Supprimer la condition 1 : Email' }));
    expect(screen.getByRole('textbox', { name: 'Valeur : Email' })).toHaveValue('test');
  });

  it('stops at the 10 conditions of the list instead of losing the 11th', async () => {
    const user = setupUser();
    const specs: FilterSpecs<'email' | 'bpm' | 'login'> = { email: EMAIL, bpm: BPM, login: LOGIN };
    const full: ActiveFilter<'email' | 'bpm' | 'login'>[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        field: 'email' as const,
        op: 'contains' as const,
        value: `v${i}`,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        field: 'bpm' as const,
        op: 'gt' as const,
        value: i,
      })),
    ];
    const setFilters = vi.fn();
    function Menus() {
      const { filter } = operatorFilters(specs, full, setFilters);
      return (
        <>
          <section aria-label="login">{filter('login').content}</section>
          <section aria-label="bpm">{filter('bpm').content}</section>
        </>
      );
    }
    renderWithProviders(<Menus />);
    // A new column: no room left, said so, nothing to apply.
    // (MPM is at its own cap of 5 per column, not at the list's.)
    expect(screen.getAllByText(/10 conditions au plus sur la liste/)).toHaveLength(1);
    await pickOption(
      user,
      screen.getByRole('textbox', { name: 'Opérateur : Connexion' }),
      'est vide',
    );
    expect(screen.getByRole('button', { name: 'Appliquer le filtre : Connexion' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Ajouter une condition : Connexion' }),
    ).toBeDisabled();
    // A column already filtered can still change its conditions, not add one.
    expect(screen.getByRole('button', { name: 'Ajouter une condition : MPM' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Supprimer la condition 5 : MPM' }));
    await user.click(screen.getByRole('button', { name: 'Appliquer le filtre : MPM' }));
    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(setFilters.mock.calls[0][0]).toHaveLength(9);
  });

  it('offers one removable chip per condition, saying how it joins', async () => {
    const user = setupUser();
    const specs: FilterSpecs<'email' | 'bpm'> = { email: EMAIL, bpm: BPM };
    function Chips() {
      const [filters, setFilters] = useState<ActiveFilter<'email' | 'bpm'>[]>([
        { field: 'email', op: 'contains', value: 'gmail', join: 'or' },
        { field: 'email', op: 'contains', value: 'hotmail', join: 'or' },
        { field: 'bpm', op: 'gt', value: 30 },
      ]);
      const { chips, filter } = operatorFilters(specs, filters, setFilters);
      return (
        <>
          <p data-testid="active">{String(filter('email').active)}</p>
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.onRemove}>
              {chip.label}
            </button>
          ))}
        </>
      );
    }
    renderWithProviders(<Chips />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Email contient « gmail »',
      'ou Email contient « hotmail »',
      'MPM supérieur à 30',
    ]);
    await user.click(screen.getByRole('button', { name: 'Email contient « gmail »' }));
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Email contient « hotmail »',
      'MPM supérieur à 30',
    ]);
    expect(screen.getByTestId('active')).toHaveTextContent('true');
  });
});
