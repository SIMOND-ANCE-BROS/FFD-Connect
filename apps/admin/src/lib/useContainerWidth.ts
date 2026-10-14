import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Inner width of an element, in px, followed as the window or the menu
 * resizes. 0 until measured (and in jsdom, which lays nothing out).
 */
export function useContainerWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const next = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    next.observe(node);
    observer.current = next;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, width];
}
