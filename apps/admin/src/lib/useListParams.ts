import { useEffect, useRef, useState } from 'react';
import { type NavigateOptions, useLocation, useSearchParams } from 'react-router';
import { useListReturn } from './listReturn';

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
  const { pathname } = useLocation();
  const remember = useListReturn((s) => s.remember);
  const seen = useRef(params);
  const latest = useRef(params);
  // A new URL (ours once applied, or Back/Forward, a link) becomes the base.
  if (seen.current !== params) {
    seen.current = params;
    latest.current = params;
  }
  // « Retour à la liste » of a record page comes back to this very URL (#562).
  const search = params.toString();
  useEffect(() => remember(pathname, search), [remember, pathname, search]);
  const update = (patch: Patch, options?: NavigateOptions) => {
    const next = write(latest.current, patch);
    latest.current = next;
    setParams(next, options);
  };
  return [read(params), update];
}

/**
 * Same list state as {@link useListParams}, kept in memory instead of the URL:
 * for a list inside a dialog (#558), whose filters must not change the page URL.
 */
export function useMemoryListParams<State, Patch>(
  read: (params: URLSearchParams) => State,
  write: (current: URLSearchParams, patch: Patch) => URLSearchParams,
): [State, (patch: Patch) => void] {
  const [params, setParams] = useState(() => new URLSearchParams());
  const update = (patch: Patch) => setParams((current) => write(current, patch));
  return [read(params), update];
}
