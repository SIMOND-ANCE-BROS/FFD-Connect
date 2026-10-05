#!/usr/bin/env node
/**
 * Met à jour les corps des Epics et des Issues déjà créées sur GitHub
 * pour respecter le format défini dans docs/GITHUB_ISSUE_BODY_TEMPLATES.md
 *
 * Usage: node scripts/update-github-issue-bodies.mjs [--dry-run] [--epics-only] [--issues-only]
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, 'github-issues-data.json');
const dryRun = process.argv.includes('--dry-run');
const epicsOnly = process.argv.includes('--epics-only');
const issuesOnly = process.argv.includes('--issues-only');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const ticketById = new Map(data.issues.map((i) => [i.id, i]));

function run(cmd, opts = {}) {
  const defaultOpts = { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 };
  const isEdit = cmd.includes('issue edit');
  if (dryRun && isEdit) {
    console.log('[dry-run]', cmd.slice(0, 90) + '...');
    return '';
  }
  return execSync(cmd, { ...defaultOpts, ...opts });
}

function getEpicIssueNumbers() {
  const out = run('gh issue list --label epic --limit 30 --state all --json number,title');
  const list = JSON.parse(out || '[]');
  const map = {};
  for (const issue of list) {
    const m = issue.title.match(/^EPIC-(\d+)\s*[: ]/);
    if (m) map[parseInt(m[1], 10)] = issue.number;
  }
  return map;
}

function buildEpicBody(epic) {
  const body = epic.body || '';
  const objectifMatch = body.match(/\*\*Objectif\*\*\s*:\s*(.+?)(?=\n\*\*|\n\n|$)/s);
  const objectif = objectifMatch ? objectifMatch[1].trim() : body.split('\n')[0] || '—';
  const moduleMatch = body.match(/\*\*(?:Module|Feature)\*\*\s*:\s*`([^`]+)`/);
  const moduleName = moduleMatch ? moduleMatch[1] : (epic.labels.find((l) => !['epic', 'backend', 'client'].includes(l)) || '—');
  const stack = epic.labels.includes('client') ? 'Client (Expo)' : 'Backend (NestJS)';
  const notesMatch = body.match(/\*\*(?:Fonctionnalités transverses|Notes?)\*\*\s*:\s*(.+?)$/s);
  const notes = notesMatch ? notesMatch[1].trim() : '';

  return `## Objectif

${objectif}

## Périmètre

| Élément | Détail |
|--------|--------|
| **Module / Feature** | \`${moduleName}\` |
| **Stack** | ${stack} |

## Livrables (tâches liées)

Les tâches sont liées via la relation **Parent issue** (Relationships). Voir les sub-issues de cette epic.

## Notes

${notes || '—'}
`;
}

function slugFromTitle(title) {
  if (!title) return 'feature';
  const firstWord = title.split(/[\s(]+/)[0] || '';
  return firstWord
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '') || 'feature';
}

function buildIssueBody(issue) {
  const desc = issue.description || '';
  const contexte = desc.split(/[.—]/)[0].trim() || issue.title;
  const acceptance = issue.acceptance || '';
  const criteria = acceptance
    .split(/\s*;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `- [ ] ${s}`)
    .join('\n');

  const isBackend = issue.labels.includes('backend');
  const endpointMatch = desc.match(/(GET|POST|PATCH|PUT|DELETE)\s+[\w/:-]+/);
  const slug = slugFromTitle(issue.title);
  const notesTech = [];
  if (endpointMatch) notesTech.push(`- Endpoint : \`${endpointMatch[0]}\``);
  else if (!isBackend && (desc.includes('Screen') || desc.includes('Modal'))) {
    const screenMatch = desc.match(/(\w+Screen|\w+Modal)/);
    if (screenMatch) notesTech.push(`- Écran : \`${screenMatch[1]}\``);
  }
  if (isBackend) notesTech.push(`- Module : voir épic parent.`);
  notesTech.push(`- **Branche suggérée** : \`feat/${issue.id}-${slug}\` ou \`fix/${issue.id}-${slug}\``);

  return `## Contexte

${contexte}.

## Description

${desc}

## Critères d'acceptation

${criteria || '- [ ] (à compléter)'}

## QA & Tests requis

- [ ] Tests unitaires (si applicable)
- [ ] Tests d'intégration / E2E (si applicable)

## Notes techniques

${notesTech.join('\n')}

## Sous-tâches (optionnel)

Pour détailler en sub-issues, créer des issues et les lier avec **Parent issue** pointant vers cette issue.
`;
}

function updateIssueBody(issueNumber, newBody) {
  const bodyFile = path.join(__dirname, '.gh-body-update.txt');
  fs.writeFileSync(bodyFile, newBody, 'utf-8');
  try {
    run(`gh issue edit ${issueNumber} --body-file "${bodyFile}"`);
    return true;
  } finally {
    try {
      fs.unlinkSync(bodyFile);
    } catch (_) {}
  }
}

function getAllTaskIssues(epicIssueNumbers) {
  const epicNums = new Set(Object.values(epicIssueNumbers));
  const all = [];
  let page = 1;
  while (true) {
    const raw = run(
      `gh api "repos/GabinSMD/FFD-Connect/issues?state=all&per_page=100&page=${page}"`
    );
    const arr = JSON.parse(raw || '[]');
    if (arr.length === 0) break;
    for (const i of arr) {
      if (epicNums.has(i.number)) continue;
      if (!/^[A-Z][A-Z0-9]*-?\d+:\s/.test(i.title || '')) continue;
      all.push({ number: i.number, title: i.title });
    }
    if (arr.length < 100) break;
    page++;
  }
  return all;
}

function extractTicketId(title) {
  const m = (title || '').match(/^([A-Z][A-Z0-9]*-?\d+):\s/);
  return m ? m[1] : null;
}

function main() {
  const bodyFile = path.join(__dirname, '.gh-body-update.txt');

  if (!issuesOnly && data.epics?.length) {
    console.log('--- Mise à jour des Epics ---');
    const epicNumToIssue = getEpicIssueNumbers();
    for (const epic of data.epics) {
      const issueNumber = epicNumToIssue[epic.epicNum];
      if (!issueNumber) {
        console.log('  Skip EPIC-' + epic.epicNum + ' (issue non trouvée)');
        continue;
      }
      const newBody = buildEpicBody(epic);
      fs.writeFileSync(bodyFile, newBody, 'utf-8');
      updateIssueBody(issueNumber, newBody);
      console.log('  Mis à jour Epic #' + issueNumber, epic.title?.slice(0, 50));
    }
  }

  if (!epicsOnly && data.issues?.length) {
    console.log('\n--- Mise à jour des Issues (tâches) ---');
    const epicNumToIssue = getEpicIssueNumbers();
    const taskIssues = getAllTaskIssues(epicNumToIssue);
    let updated = 0;
    for (const issue of taskIssues) {
      const ticketId = extractTicketId(issue.title);
      const ticket = ticketId ? ticketById.get(ticketId) : null;
      if (!ticket) continue;
      const newBody = buildIssueBody(ticket);
      updateIssueBody(issue.number, newBody);
      updated++;
      if (updated <= 15 || updated % 20 === 0) {
        console.log('  Mis à jour #' + issue.number, ticketId);
      }
    }
    console.log('  Total issues mises à jour:', updated);
  }

  try {
    fs.unlinkSync(bodyFile);
  } catch (_) {}
  console.log('\nTerminé.' + (dryRun ? ' (dry-run)' : ''));
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
