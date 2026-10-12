import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The funnel button of a column header (DataTable), active or not. */
export const columnFilterButton = (column: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^Filtrer : ${escape(column)}( \\(|$)`) });

/** Opens the filter menu of a column header. */
export async function openColumnFilter(user: UserEvent, column: string): Promise<void> {
  await user.click(columnFilterButton(column));
}

/** The sort button of a column header (its accessible name is the column label). */
export const sortButton = (column: string): HTMLElement =>
  screen.getByRole('button', { name: column });
