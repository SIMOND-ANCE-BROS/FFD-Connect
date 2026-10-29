import { Combobox, createTheme, MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, type RenderResult, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';

// Shared test harness for the back-office pages (#257, #385). Rendering a whole
// Mantine page and replaying user input event by event pushed many tests past
// Vitest's 5 s budget on a loaded full-suite run, so every page test goes through
// these cheaper defaults.

/**
 * A user-event instance with no delay between actions: the default `delay: 0`
 * still yields to the event loop after every key and click.
 */
export function setupUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

/**
 * Replaces a text field's value in one input event (paste) instead of one per
 * character, which re-renders the whole Mantine form each time. Only for fields
 * whose behaviour does not depend on per-character input.
 */
export async function fill(user: UserEvent, input: HTMLElement, text: string): Promise<void> {
  await user.clear(input);
  await user.paste(text);
}

/**
 * Waits `ms` of real time inside `act`, so state updates fired meanwhile (a
 * debounced search, the query it starts) are flushed instead of warning about
 * an update not wrapped in act(...).
 */
export function sleep(ms: number): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

/** Opens a Mantine Select and picks one of its options. */
export async function pickOption(user: UserEvent, input: HTMLElement, name: string): Promise<void> {
  await user.click(input);
  // Only an open dropdown is mounted (see testTheme below): its listbox is the only one.
  const listbox = await screen.findByRole('listbox', { hidden: true });
  await user.click(within(listbox).getByRole('option', { name, hidden: true }));
}

/**
 * Mantine keeps the dropdown of every closed Select mounted (hidden) and
 * re-positions it with floating-ui on each render, which in jsdom means dozens
 * of `getComputedStyle` calls for a layout that does not exist. On a form page
 * with several selects that was more than half the CPU of a test (#385). Tests
 * open a select before picking an option, which mounts its dropdown, so only
 * closed dropdowns leave the DOM.
 */
export const testTheme = createTheme({
  // `env="test"` only skips the transition styles: the transition hook still
  // schedules a requestAnimationFrame + setTimeout on every open/close, and one
  // started as the page unmounted outlived the test and threw « window is not
  // defined » after jsdom teardown (#660, #803). Honouring the reduced-motion
  // preference that the matchMedia stub reports (vitest.setup.ts) makes every
  // transition zero-length and synchronous: no timer is ever left behind.
  respectReducedMotion: true,
  components: {
    Combobox: Combobox.extend({ defaultProps: { keepMounted: false } }),
  },
});

export interface RenderOptions {
  /** Initial URL of the in-memory router (default `/`). */
  route?: string;
  /** Query client to use; defaults to one that never retries a failed query. */
  queryClient?: QueryClient;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/**
 * Renders `ui` (a page, or `<Routes>` around it) inside Mantine, React Query and
 * an in-memory router. `env="test"` turns off Mantine transitions and portals,
 * so dialogs, menus and dropdowns render at once inside the container.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', queryClient = createTestQueryClient() }: RenderOptions = {},
): RenderResult {
  return render(
    <MantineProvider env="test" theme={testTheme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}
