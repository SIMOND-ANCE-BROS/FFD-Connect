import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { useListReturn } from './src/lib/listReturn';

// findBy*/waitFor give up after 1 s by default. A page that debounces its search
// (300 ms) then renders the results of a mocked query can need longer than that
// on a loaded full-suite run, which failed tests that were otherwise correct
// (#385). Waiting longer for an element that must appear does not weaken any
// assertion: a missing element still fails, just later.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  // Column choices of the lists (#444) must not leak from one test to the next.
  localStorage.clear();
  // Nor the list URLs remembered for « Retour à la liste » (#562).
  useListReturn.setState({ searches: {} });
});

// Mantine needs matchMedia and ResizeObserver in jsdom. The stub is a desktop
// that asks for reduced motion: with `respectReducedMotion` (src/test/render.tsx)
// every Mantine transition then runs with a zero duration, synchronously.
// Otherwise a transition schedules requestAnimationFrame + setTimeout, and one
// started as the page unmounts (a dialog closing while the page navigates away)
// escaped the unmount cleanup: its timer fired after jsdom was torn down and
// failed the run with « ReferenceError: window is not defined » (#660, #803).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// Mantine's Select scrolls the active option into view.
Element.prototype.scrollIntoView = () => {};
