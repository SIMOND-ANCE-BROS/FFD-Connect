import { useEffect, useState } from 'react';

const GITHUB_API = 'https://api.github.com';
const ROADMAP_LABEL = 'roadmap';

export interface Milestone {
  id: number;
  number: number;
  title: string;
  description: string | null;
  state: string;
  open_issues: number;
  closed_issues: number;
  due_on: string | null;
  created_at: string;
}

export interface RoadmapIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  labels: { name: string; color: string }[];
  milestone: Milestone | null;
}

interface RoadmapData {
  milestones: Milestone[];
  issues: RoadmapIssue[];
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  return {
    owner: owner?.trim() || 'GabinSMD',
    repo: name?.trim() || 'FFD-Connect',
  };
}

export function useGitHubRoadmap() {
  const [data, setData] = useState<RoadmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const repoStr = import.meta.env.VITE_GITHUB_REPO || 'GabinSMD/FFD-Connect';
    const { owner, repo } = parseRepo(repoStr);

    const fetchRoadmap = async () => {
      try {
        const [milestonesRes, issuesRes] = await Promise.all([
          fetch(`${GITHUB_API}/repos/${owner}/${repo}/milestones?state=open&per_page=20`, {
            headers: { Accept: 'application/vnd.github.v3+json' },
          }),
          fetch(
            `${GITHUB_API}/repos/${owner}/${repo}/issues?labels=${ROADMAP_LABEL}&state=open&per_page=50`,
            { headers: { Accept: 'application/vnd.github.v3+json' } },
          ),
        ]);

        if (!milestonesRes.ok || !issuesRes.ok) {
          throw new Error('GitHub API limit or repo not found');
        }

        const [milestones, issues] = await Promise.all([
          milestonesRes.json() as Promise<Milestone[]>,
          issuesRes.json() as Promise<RoadmapIssue[]>,
        ]);

        // Sort milestones by due_on (null last)
        milestones.sort((a, b) => {
          if (!a.due_on) return 1;
          if (!b.due_on) return -1;
          return new Date(a.due_on).getTime() - new Date(b.due_on).getTime();
        });

        setData({ milestones, issues });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load roadmap');
        // FALLBACK MOCK DATA FOR DESIGN PURPOSES WHEN RATE LIMITED
        setData({
          milestones: [
            {
              id: 1,
              number: 1,
              title: '🚀 Prochaine Version (Q3)',
              description: 'Fonctionnalités clés à venir',
              state: 'open',
              open_issues: 3,
              closed_issues: 0,
              due_on: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              created_at: new Date().toISOString(),
            },
            {
              id: 2,
              number: 2,
              title: '🔮 Version Suivante (Q4)',
              description: 'Améliorations futures',
              state: 'open',
              open_issues: 2,
              closed_issues: 0,
              due_on: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
              created_at: new Date().toISOString(),
            },
          ],
          issues: [
            {
              id: 101,
              number: 101,
              title: 'Intégration Stripe pour la billetterie',
              state: 'open',
              html_url: '#',
              body: '',
              labels: [],
              milestone: { id: 1 } as Milestone,
            },
            {
              id: 102,
              number: 102,
              title: 'Mode hors-ligne pour la régie',
              state: 'open',
              html_url: '#',
              body: '',
              labels: [],
              milestone: { id: 1 } as Milestone,
            },
            {
              id: 103,
              number: 103,
              title: 'Application mobile Apple Watch',
              state: 'open',
              html_url: '#',
              body: '',
              labels: [],
              milestone: { id: 2 } as Milestone,
            },
            {
              id: 104,
              number: 104,
              title: 'Chat intégré organisateurs/juges',
              state: 'open',
              html_url: '#',
              body: '',
              labels: [],
              milestone: { id: 2 } as Milestone,
            },
            {
              id: 105,
              number: 105,
              title: 'Export des résultats en PDF personnalisé',
              state: 'open',
              html_url: '#',
              body: '',
              labels: [],
              milestone: null,
            },
          ],
        });
      } finally {
        setLoading(false);
      }
    };

    fetchRoadmap();
  }, []);

  return { data, loading, error };
}
