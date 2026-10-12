import { useDebouncedValue } from '@mantine/hooks';
import { useEffect, useRef, useState } from 'react';

/**
 * Search input of a list whose filters live in the URL. The typed text reaches
 * the URL (hence the API) once debounced and at least `minLength` long, and
 * only when the debounced text itself changed; an outside change of the URL
 * value (Back/Forward, a link) moves the input with it.
 */
export function useUrlSearch(
  urlValue: string,
  commit: (value: string) => void,
  minLength = 0,
): [string, (value: string) => void] {
  const [search, setSearch] = useState(urlValue);
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const urlRef = useRef(urlValue);
  urlRef.current = urlValue;
  const written = useRef(urlValue);

  useEffect(() => {
    const next = debounced.length >= minLength ? debounced : '';
    if (next === urlRef.current) return;
    written.current = next;
    commitRef.current(next);
  }, [debounced, minLength]);

  useEffect(() => {
    if (urlValue === written.current) return;
    written.current = urlValue;
    setSearch(urlValue);
  }, [urlValue]);

  return [search, setSearch];
}
