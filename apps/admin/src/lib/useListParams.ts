import { useRef } from 'react';
import { type NavigateOptions, useSearchParams } from 'react-router';

/**
 * State of a list kept in the URL (#443): `read` parses the query string,
 * `write` applies a patch to it. Every write starts from the last URL this
 * page wrote, not from the one of the current render: the router applies a
 * navigation in a transition, so a debounced search committed right after a
 * header filter click would otherwise start from the URL without the filter
 * and drop it.
 */
export function useListParams<State, Patch>(
  read: (params: URLSearchParams) => State,
  write: (current: URLSearchParams, patch: Patch) => URLSearchParams,
): [State, (patch: Patch, options?: NavigateOptions) => void] {
  const [params, setParams] = useSearchParams();
  const seen = useRef(params);
  const latest = useRef(params);
  // A new URL (ours once applied, or Back/Forward, a link) becomes the base.
  if (seen.current !== params) {
    seen.current = params;
    latest.current = params;
  }
  const update = (patch: Patch, options?: NavigateOptions) => {
    const next = write(latest.current, patch);
    latest.current = next;
    setParams(next, options);
  };
  return [read(params), update];
}
