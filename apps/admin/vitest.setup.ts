import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

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
});

// Mantine needs matchMedia and ResizeObserver in jsdom.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
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
