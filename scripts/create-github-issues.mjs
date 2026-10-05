#!/usr/bin/env node
/**
 * Crée les labels, les épics et les tickets GitHub à partir de github-issues-data.json
 * Utilise le CLI GitHub (gh) — doit être authentifié : gh auth login
 *
 * Usage: node scripts/create-github-issues.mjs [--dry-run] [--skip-labels] [--issues-only]
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, 'github-issues-data.json');
const dryRun = process.argv.includes('--dry-run');
const skipLabels = process.argv.includes('--skip-labels');
const skipEpics = process.argv.includes('--skip-epics');
const startIndex = (() => {
  const i = process.argv.indexOf('--start-index');
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : 0;
})();

const repo = execSync('gh repo view --json nameWithOwner -q .nameWithOwner', {
  encoding: 'utf-8',
}).trim();

console.log(`Repo: ${repo}`);
if (dryRun) console.log('Mode dry-run: aucune création réelle.\n');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

function run(cmd, opts = {}) {
  if (dryRun) {
    console.log('[dry-run]', cmd);
    return { stdout: '', stderr: '' };
  }
  return execSync(cmd, { encoding: 'utf-8', ...opts });
}

function createLabel(label) {
  try {
    run(
      `gh label create "${label.name}" --color "${label.color}" --description "${(label.description || '').replace(/"/g, '\\"')}"`,
      { stdio: 'pipe' }
    );
    console.log('  Label créé:', label.name);
  } catch (e) {
    if (e.stderr && (e.stderr.includes('already exists') || e.stderr.includes('Validation Failed')))
      console.log('  Label existe déjà:', label.name);
    else throw e;
  }
}

function createIssue(title, body, labelList) {
  const labels = Array.isArray(labelList) ? labelList.join(',') : labelList;
  const bodyFile = path.join(__dirname, '.gh-issue-body.txt');
  fs.writeFileSync(bodyFile, body, 'utf-8');
  try {
    const out = run(
      `gh issue create --title ${JSON.stringify(title)} --body-file "${bodyFile}" --label "${labels}"`,
      { encoding: 'utf-8' }
    );
    const url = out.trim();
    console.log('  Issue créée:', url);
    return url;
  } finally {
    try {
      fs.unlinkSync(bodyFile);
    } catch (_) {}
  }
}

async function main() {
  if (!skipLabels && data.labels?.length) {
    console.log('\n--- Création des labels ---');
    for (const label of data.labels) {
      createLabel(label);
    }
  }

  const createdEpics = {};
  if (data.epics?.length && !skipEpics) {
    console.log('\n--- Création des épics (issues) ---');
    for (const epic of data.epics) {
      const title = epic.title;
      const body = epic.body || '';
      const labels = (epic.labels || []).join(',');
      if (dryRun) {
        console.log('[dry-run] Epic:', title);
        createdEpics[epic.epicNum] = '(dry-run)';
        continue;
      }
      const url = createIssue(title, body, epic.labels || []);
      createdEpics[epic.epicNum] = url;
    }
  }

  if (data.issues?.length) {
    const issuesToCreate = startIndex > 0 ? data.issues.slice(startIndex) : data.issues;
    if (startIndex > 0) console.log(`\n--- Création des tickets (à partir de l'index ${startIndex}, ${issuesToCreate.length} restants) ---`);
    else console.log('\n--- Création des tickets ---');
    for (const issue of issuesToCreate) {
      const title = `${issue.id}: ${issue.title}`;
      const body = [
        `## Description\n\n${issue.description || ''}`,
        `## Critères d'acceptation\n\n${issue.acceptance || ''}`,
        `---\n*Epic: EPIC-${issue.epic}*`,
      ].join('\n\n');
      const labels = issue.labels || [];
      if (dryRun) {
        console.log('[dry-run]', issue.id, issue.title);
        continue;
      }
      createIssue(title, body, labels);
    }
  }

  console.log('\nTerminé.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
