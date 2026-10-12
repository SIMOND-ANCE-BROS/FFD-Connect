import { useEffect, useRef, useState } from 'react';
import { Check, GitBranch } from 'lucide-react';
import { repository } from './lib/ffd';
import {
  buildRoadmap,
  issuesUrl,
  milestonesUrl,
  type GitHubIssue,
  type GitHubMilestone,
  type RoadmapGroup,
} from './roadmap-logic';

const FETCH_TIMEOUT_MS = 6500;

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  // Unauthenticated read of the public GitHub API: no token, no backend call.
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Public roadmap: issues labelled `roadmap` that carry a `## Pour le public`
 * section, grouped by open milestone. Loaded lazily when the section nears the
 * viewport; any failure shows a neutral message, never placeholder data.
 */
export function PublicRoadmap() {
  const [groups, setGroups] = useState<RoadmapGroup[] | null>(null);
  const [error, setError] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return;
        started = true;
        observer.disconnect();
        timer = setTimeout(() => {
          setError(true);
          controller.abort();
        }, FETCH_TIMEOUT_MS);
        Promise.all([
          fetchJson<GitHubMilestone[]>(milestonesUrl(), controller.signal),
          fetchJson<GitHubIssue[]>(issuesUrl(), controller.signal),
        ])
          .then(([milestones, issues]) => {
            clearTimeout(timer);
            setGroups(buildRoadmap(milestones, issues));
          })
          .catch(() => {
            clearTimeout(timer);
            if (!controller.signal.aborted) setError(true);
          });
      },
      { rootMargin: '400px' },
    );
    if (container.current) observer.observe(container.current);
    return () => {
      clearTimeout(timer);
      controller.abort();
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className="project-feed"
      ref={container}
      aria-live="polite"
      aria-busy={groups === null && !error}
    >
      {error || (groups !== null && groups.length === 0) ? (
        <div className="feed-fallback">
          {error ? <GitBranch size={28} /> : <Check size={28} />}
          <h3>
            {error
              ? 'La feuille de route est momentanément indisponible.'
              : 'La feuille de route est en cours de préparation.'}
          </h3>
          <p>Les évolutions à venir sont suivies publiquement dans le dépôt du projet.</p>
          <a className="text-link" href={repository + '/issues'} target="_blank" rel="noreferrer">
            Consulter le suivi sur GitHub
          </a>
        </div>
      ) : groups === null ? (
        <div className="feed-loading">
          <span aria-hidden="true" />
          <p>Chargement de la feuille de route…</p>
        </div>
      ) : (
        <div className="roadmap-groups">
          {groups.map((group) => (
            <section className="roadmap-group" key={group.key ?? 'later'}>
              <h3 className="roadmap-group-title">
                <span>{group.title}</span>
                {group.due && <span className="roadmap-group-due">{group.due}</span>}
              </h3>
              <ul className="roadmap-items">
                {group.items.map((item) => (
                  <li key={item.number}>
                    <Check size={17} aria-hidden="true" />
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
