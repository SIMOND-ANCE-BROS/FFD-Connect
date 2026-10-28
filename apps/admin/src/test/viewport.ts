import { vi } from 'vitest';

/**
 * Lays every observed element out `width` px wide (jsdom measures nothing):
 * what a DataTable sees of its container (#556). Undone by vi.unstubAllGlobals().
 */
export function mockContainerWidth(width: number) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const entry = { target, contentRect: { width } } as unknown as ResizeObserverEntry;
        this.callback([entry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
}
import { MOBILE_QUERY } from '../lib/useIsMobile';

/**
 * Makes `useIsMobile()` true for the next renders: jsdom's matchMedia stub
 * (vitest.setup.ts) matches nothing, i.e. a desktop. Undone by vi.restoreAllMocks().
 */
export function mockPhoneViewport() {
  const desktop = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    ...desktop(query),
    media: query,
    // Keeps the stub's other answers (reduced motion, see vitest.setup.ts).
    matches: query === MOBILE_QUERY || desktop(query).matches,
  }));
}
