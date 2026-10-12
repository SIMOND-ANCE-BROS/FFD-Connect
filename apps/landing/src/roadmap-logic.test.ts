import { describe, expect, it } from 'vitest';
import {
  buildRoadmap,
  extractPublicSummary,
  formatDue,
  issuesUrl,
  milestonesUrl,
  stripMarkdown,
  type GitHubIssue,
  type GitHubMilestone,
} from './roadmap-logic';

const body = (summary: string) =>
  `## Contexte\n\nDétail technique interne.\n\n## Pour le public\n\n${summary}\n\n## Critères d'acceptation\n\n- [ ] test`;

describe('extractPublicSummary', () => {
  it('returns the text of the section', () => {
    expect(extractPublicSummary(body('Retrouvez vos résultats dans l’app.'))).toBe(
      'Retrouvez vos résultats dans l’app.',
    );
  });

  it('returns null when the section is missing', () => {
    expect(extractPublicSummary('## Contexte\n\nUniquement technique.')).toBeNull();
    expect(extractPublicSummary('')).toBeNull();
    expect(extractPublicSummary(null)).toBeNull();
    expect(extractPublicSummary(undefined)).toBeNull();
  });

  it('returns null when the section is empty', () => {
    expect(extractPublicSummary('## Pour le public\n\n## Critères\n\n- a')).toBeNull();
    expect(extractPublicSummary('## Pour le public\n   \n')).toBeNull();
    expect(extractPublicSummary('## Pour le public')).toBeNull();
    expect(extractPublicSummary('## Pour le public\n\n<!-- à remplir -->\n')).toBeNull();
  });

  it('stops at the next level-2 heading', () => {
    expect(extractPublicSummary('## Pour le public\nUne phrase.\n## Constat\nInterne.')).toBe(
      'Une phrase.',
    );
  });

  it('keeps only the first paragraph and joins its lines', () => {
    expect(
      extractPublicSummary('## Pour le public\n\nPremière ligne\nsuite.\n\nSecond paragraphe.'),
    ).toBe('Première ligne suite.');
  });

  it('reads a section appended at the end of the body', () => {
    expect(
      extractPublicSummary(
        '## Contexte\n\nX\n\n## Liens\n\n- #1\n\n## Pour le public\n\nTexte final.\n',
      ),
    ).toBe('Texte final.');
  });

  it('skips the template comment, even when followed by a blank line', () => {
    expect(
      extractPublicSummary(
        '## Pour le public\n\n<!--\nConsigne\n\nsur deux paragraphes.\n-->\n\nTexte.\n',
      ),
    ).toBe('Texte.');
    expect(extractPublicSummary('<!-- ## Pour le public -->\nTexte.')).toBeNull();
  });

  it('handles CRLF bodies', () => {
    expect(
      extractPublicSummary('## Contexte\r\n\r\nX\r\n\r\n## Pour le public\r\n\r\nTexte.\r\n'),
    ).toBe('Texte.');
  });

  it('matches the heading case-insensitively with trailing spaces', () => {
    expect(extractPublicSummary('##  pour le public  \nTexte.')).toBe('Texte.');
  });

  it('ignores a level-3 heading with the same name', () => {
    expect(extractPublicSummary('### Pour le public\nTexte.')).toBeNull();
  });

  it('strips markdown to plain text', () => {
    expect(
      extractPublicSummary(
        '## Pour le public\n\n**Nouveau** : votre [licence](https://x.y) dans `Wallet`, _enfin_.',
      ),
    ).toBe('Nouveau : votre licence dans Wallet, enfin.');
  });
});

describe('stripMarkdown', () => {
  it('removes list markers, quotes, html and strikethrough', () => {
    expect(stripMarkdown('> - [ ] une <b>étape</b> ~~barrée~~\n* *deux*')).toBe(
      'une étape barrée deux',
    );
  });

  it('keeps underscores inside words', () => {
    expect(stripMarkdown('mot_composé')).toBe('mot_composé');
  });
});

describe('formatDue', () => {
  it('formats a due date as month and year in French', () => {
    expect(formatDue('2026-12-13T00:00:00Z')).toBe('décembre 2026');
  });

  it('returns null for a missing or invalid date', () => {
    expect(formatDue(null)).toBeNull();
    expect(formatDue('pas une date')).toBeNull();
  });
});

describe('URLs', () => {
  it('targets the public repository without authentication', () => {
    expect(milestonesUrl()).toBe(
      'https://api.github.com/repos/SIMOND-ANCE-BROS/FFD-Connect/milestones?state=open&sort=due_on&direction=asc&per_page=50',
    );
    expect(issuesUrl()).toBe(
      'https://api.github.com/repos/SIMOND-ANCE-BROS/FFD-Connect/issues?state=open&labels=roadmap&per_page=100',
    );
  });
});

describe('buildRoadmap', () => {
  const milestones: GitHubMilestone[] = [
    { number: 3, title: 'v1.1', due_on: '2027-02-28T00:00:00Z' },
    { number: 9, title: 'Sans date', due_on: null },
    { number: 1, title: 'Bêta', due_on: '2026-10-25T00:00:00Z' },
    { number: 2, title: 'v1.0', due_on: '2026-12-13T00:00:00Z' },
  ];
  const issue = (
    number: number,
    milestone: number | null,
    summary: string | null,
    extra: Partial<GitHubIssue> = {},
  ): GitHubIssue => ({
    number,
    body: summary === null ? '## Contexte\n\nTechnique.' : body(summary),
    milestone: milestone === null ? null : { number: milestone },
    ...extra,
  });

  it('groups by milestone sorted by due date, undated milestones last', () => {
    const groups = buildRoadmap(milestones, [
      issue(10, 3, 'C'),
      issue(11, 9, 'D'),
      issue(12, 1, 'A'),
      issue(13, 2, 'B'),
    ]);
    expect(groups.map((g) => [g.title, g.due, g.items.map((i) => i.text)])).toEqual([
      ['Bêta', 'octobre 2026', ['A']],
      ['v1.0', 'décembre 2026', ['B']],
      ['v1.1', 'février 2027', ['C']],
      ['Sans date', null, ['D']],
    ]);
  });

  it('drops issues without a public section and pull requests', () => {
    const groups = buildRoadmap(milestones, [
      issue(20, 1, null),
      issue(21, 1, 'PR', { pull_request: { url: 'x' } }),
      issue(22, 1, 'Visible'),
    ]);
    expect(groups).toEqual([
      { key: 1, title: 'Bêta', due: 'octobre 2026', items: [{ number: 22, text: 'Visible' }] },
    ]);
  });

  it('puts issues without an open milestone in a final « Plus tard » group', () => {
    const groups = buildRoadmap(milestones, [
      issue(31, null, 'Sans jalon'),
      issue(30, 42, 'Jalon fermé'),
      issue(32, 2, 'Planifié'),
    ]);
    expect(groups.map((g) => [g.key, g.title, g.items.map((i) => i.number)])).toEqual([
      [2, 'v1.0', [32]],
      [null, 'Plus tard', [30, 31]],
    ]);
  });

  it('hides empty groups and returns nothing when no issue qualifies', () => {
    expect(buildRoadmap(milestones, [])).toEqual([]);
    expect(buildRoadmap(milestones, [issue(1, 1, null)])).toEqual([]);
    expect(buildRoadmap([], [])).toEqual([]);
  });

  it('never exposes titles or labels', () => {
    const [group] = buildRoadmap(milestones, [
      {
        ...issue(40, 1, 'Texte public'),
        title: 'refactor(ci): technical title',
        labels: [{ name: 'ci' }],
      } as GitHubIssue,
    ]);
    expect(JSON.stringify(group)).not.toContain('technical');
    expect(JSON.stringify(group)).not.toContain('"ci"');
  });
});
