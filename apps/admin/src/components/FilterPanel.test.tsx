import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { mockPhoneViewport } from '../test/viewport';
import { FilterPanel } from './FilterPanel';

function renderPanel(activeCount: number, onReset = vi.fn()) {
  render(
    <MantineProvider>
      <FilterPanel activeCount={activeCount} onReset={onReset}>
        <p>filtres secondaires</p>
      </FilterPanel>
    </MantineProvider>,
  );
  return onReset;
}

describe('FilterPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the filters as-is on a desktop, without a toggle', () => {
    renderPanel(2);
    expect(screen.getByText('filtres secondaires')).toBeVisible();
    expect(screen.queryByRole('button', { name: /filtres/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Réinitialiser' })).toBeNull();
  });

  it('folds the filters behind a « Filtres » button on a phone', async () => {
    mockPhoneViewport();
    renderPanel(0);
    const toggle = screen.getByRole('button', { name: 'Filtres' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('filtres secondaires')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('counts the active filters and offers a reset only when some are set', async () => {
    mockPhoneViewport();
    const onReset = renderPanel(2);
    expect(screen.getByRole('button', { name: 'Filtres (2)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('hides the reset action when no filter is set', () => {
    mockPhoneViewport();
    renderPanel(0);
    expect(screen.queryByRole('button', { name: 'Réinitialiser' })).toBeNull();
  });
});
