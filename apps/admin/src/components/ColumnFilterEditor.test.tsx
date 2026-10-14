import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import { fill, pickOption, renderWithProviders, setupUser } from '../test/render';
import { ColumnFilterEditor } from './ColumnFilterEditor';

const BPM = { label: 'MPM', kind: 'number' } as const;
const LOGIN = { label: 'Connexion', kind: 'date', nullable: true } as const;

describe('ColumnFilterEditor (#557)', () => {
  it('applies a number range only once both bounds are set', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    renderWithProviders(
      <ColumnFilterEditor field="bpm" spec={BPM} current={undefined} onChange={onChange} />,
    );
    await pickOption(user, screen.getByRole('textbox', { name: 'Opérateur : MPM' }), 'entre');
    const apply = screen.getByRole('button', { name: 'Appliquer le filtre : MPM' });
    await fill(user, screen.getByRole('textbox', { name: 'Valeur : MPM (min)' }), '28');
    expect(apply).toBeDisabled();
    await fill(user, screen.getByRole('textbox', { name: 'Valeur : MPM (max)' }), '31');
    await user.click(apply);
    expect(onChange).toHaveBeenLastCalledWith({ field: 'bpm', op: 'between', value: [28, 31] });
  });

  it('applies « est vide » without a value, and removes the current filter', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    renderWithProviders(
      <ColumnFilterEditor
        field="login"
        spec={LOGIN}
        current={{ field: 'login', op: 'lt', value: '2026-10-14' }}
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
    expect(onChange).toHaveBeenLastCalledWith({ field: 'login', op: 'isEmpty' });
    await user.click(screen.getByRole('button', { name: 'Retirer le filtre : Connexion' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
