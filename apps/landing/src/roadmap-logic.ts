// Pure logic of the public roadmap shown on the landing page (kept free of DOM
// and network access so it can be unit-tested).
//
// Source: the public GitHub REST API of the repository. Only open issues that
// carry the `roadmap` label AND a non-empty `## Pour le public` section are
// shown, and only the text of that section is displayed — never the technical
// issue title nor its labels. See docs/guides/gestion-des-issues.md §5.

export const ROADMAP_REPOSITORY = 'SIMOND-ANCE-BROS/FFD-Connect';
export const ROADMAP_LABEL = 'roadmap';
export const PUBLIC_SECTION_TITLE = 'Pour le public';
export const LATER_GROUP_TITLE = 'Plus tard';

const GITHUB_API = 'https://api.github.com';

/** Subset of a GitHub milestone used by the roadmap. */
export interface GitHubMilestone {
  number: number;
  title: string;
  due_on: string | null;
}

/** Subset of a GitHub issue (the issues endpoint also returns pull requests). */
export interface GitHubIssue {
  number: number;
  body?: string | null;
  milestone: { number: number } | null;
  pull_request?: unknown;
}

export interface RoadmapItem {
  number: number;
  text: string;
}

export interface RoadmapGroup {
  /** Milestone number, or null for the "Plus tard" group. */
  key: number | null;
  title: string;
  /** Due date formatted as month/year in French, or null when absent. */
  due: string | null;
  items: RoadmapItem[];
}

export function milestonesUrl(repository: string = ROADMAP_REPOSITORY): string {
  return `${GITHUB_API}/repos/${repository}/milestones?state=open&sort=due_on&direction=asc&per_page=50`;
}

export function issuesUrl(repository: string = ROADMAP_REPOSITORY): string {
  return `${GITHUB_API}/repos/${repository}/issues?state=open&labels=${ROADMAP_LABEL}&per_page=100`;
}

/** Turns a small markdown fragment into plain text. */
export function stripMarkdown(markdown: string): string {
  return (
    markdown
      // HTML comments and tags
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '')
      // line prefixes: blockquotes, list markers, headings
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      // images, then links: keep the label
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // inline code, emphasis, strikethrough
      .replace(/`([^`]*)`/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/(^|\W)_([^_]+)_(?!\w)/g, '$1$2')
      .replace(/~~(.+?)~~/g, '$1')
      // collapse whitespace (soft line breaks become spaces)
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Returns the first paragraph of the `## Pour le public` section as plain text,
 * or null when the section is missing or empty.
 */
export function extractPublicSummary(body: string | null | undefined): string | null {
  if (!body) return null;
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const heading = new RegExp(`^##\\s+${PUBLIC_SECTION_TITLE}\\s*#*\\s*$`, 'i');
  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start === -1) return null;

  const paragraph: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // Any heading of level 1 or 2 closes the section.
    if (/^#{1,2}\s/.test(line.trim())) break;
    if (line.trim() === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line);
  }
  const text = stripMarkdown(paragraph.join('\n'));
  return text === '' ? null : text;
}

/** "déc. 2026" style label, or null when the date is absent or invalid. */
export function formatDue(dueOn: string | null): string | null {
  if (!dueOn) return null;
  const date = new Date(dueOn);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dueTime(milestone: GitHubMilestone): number {
  const time = milestone.due_on ? new Date(milestone.due_on).getTime() : Number.NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * Builds the public roadmap: issues with a public summary grouped by open
 * milestone (sorted by due date, undated last), then a "Plus tard" group for
 * issues without an open milestone. Pull requests and empty groups are dropped.
 */
export function buildRoadmap(
  milestones: readonly GitHubMilestone[],
  issues: readonly GitHubIssue[],
): RoadmapGroup[] {
  const byMilestone = new Map<number | null, RoadmapItem[]>();
  const known = new Set(milestones.map((milestone) => milestone.number));

  for (const issue of issues) {
    if (issue.pull_request !== undefined) continue;
    const text = extractPublicSummary(issue.body);
    if (text === null) continue;
    const milestone = issue.milestone?.number;
    const key = milestone !== undefined && known.has(milestone) ? milestone : null;
    const items = byMilestone.get(key) ?? [];
    items.push({ number: issue.number, text });
    byMilestone.set(key, items);
  }

  const groups: RoadmapGroup[] = [...milestones]
    .sort((a, b) => dueTime(a) - dueTime(b) || a.number - b.number)
    .map((milestone) => ({
      key: milestone.number,
      title: milestone.title,
      due: formatDue(milestone.due_on),
      items: byMilestone.get(milestone.number) ?? [],
    }));
  groups.push({
    key: null,
    title: LATER_GROUP_TITLE,
    due: null,
    items: byMilestone.get(null) ?? [],
  });

  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({ ...group, items: [...group.items].sort((a, b) => a.number - b.number) }));
}
