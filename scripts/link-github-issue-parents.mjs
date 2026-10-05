#!/usr/bin/env node
/**
 * Lie chaque ticket (tâche) à son Epic via la relation GitHub "Parent issue" (Sub-issues API).
 * Utilise POST /repos/{owner}/{repo}/issues/{parent_issue_number}/sub_issues avec sub_issue_id (id global).
 *
 * Usage: node scripts/link-github-issue-parents.mjs [--dry-run]
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, 'github-issues-data.json');
const dryRun = process.argv.includes('--dry-run');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const ticketIdToEpic = new Map(data.issues.map((i) => [i.id, i.epic]));

function run(cmd, opts = {}) {
  const defaultOpts = { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 };
  if (dryRun && (opts.skipInDryRun || cmd.includes('sub_issues'))) {
    console.log('[dry-run]', cmd.slice(0, 120) + (cmd.length > 120 ? '...' : ''));
    return '';
  }
  return execSync(cmd, { ...defaultOpts, ...opts });
}

function ghApi(method, path, body) {
  const repo = 'repos/GabinSMD/FFD-Connect';
  const url = `https://api.github.com/${repo}/${path}`;
  let cmd = `gh api ${repo}/${path} -X ${method} -H "Accept: application/vnd.github+json"`;
  if (body) {
    const tmp = path.join(__dirname, '.gh-api-body.json');
    fs.writeFileSync(tmp, JSON.stringify(body), 'utf-8');
    cmd += ` --input ${tmp}`;
    try {
      const out = run(cmd);
      return out ? JSON.parse(out) : null;
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  } else {
    const out = run(cmd);
    return out ? JSON.parse(out) : null;
  }
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

function getAllIssuesWithId() {
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const raw = run(`gh api "repos/GabinSMD/FFD-Connect/issues?state=all&per_page=${perPage}&page=${page}"`);
    const arr = JSON.parse(raw || '[]');
    if (arr.length === 0) break;
    for (const i of arr) {
      all.push({ id: i.id, number: i.number, title: i.title });
    }
    if (arr.length < perPage) break;
    page++;
  }
  return all;
}

function getTaskIssues(allIssues, epicIssueNumbers) {
  const epicNumbers = new Set(Object.values(epicIssueNumbers));
  return allIssues.filter((i) => {
    if (epicNumbers.has(i.number)) return false;
    return /^[A-Z][A-Z0-9]*-?\d+:\s/.test(i.title || '');
  });
}

function extractTicketId(title) {
  const m = (title || '').match(/^([A-Z][A-Z0-9]*-?\d+):\s/);
  return m ? m[1] : null;
}

function addSubIssue(parentIssueNumber, subIssueId) {
  const repo = 'GabinSMD/FFD-Connect';
  const body = { sub_issue_id: subIssueId };
  const tmp = path.join(__dirname, '.gh-api-body.json');
  fs.writeFileSync(tmp, JSON.stringify(body), 'utf-8');
  try {
    run(
      `gh api repos/${repo}/issues/${parentIssueNumber}/sub_issues -X POST -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" --input "${tmp}"`,
      { skipInDryRun: true }
    );
    return true;
  } catch (e) {
    if (e.stderr && (e.stderr.includes('already') || e.stderr.includes('422'))) return false;
    throw e;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

async function main() {
  console.log('Récupération des numéros d\'épics...');
  const epicNumToIssue = getEpicIssueNumbers();
  console.log('Épics:', Object.keys(epicNumToIssue).length);

  console.log('Récupération des issues (avec id global)...');
  const allIssues = getAllIssuesWithId();
  const taskIssues = getTaskIssues(allIssues, epicNumToIssue);
  console.log('Tâches à lier:', taskIssues.length);

  let linked = 0;
  let skipped = 0;
  let errors = 0;

  for (const issue of taskIssues) {
    const ticketId = extractTicketId(issue.title);
    if (!ticketId) {
      skipped++;
      continue;
    }
    const epicNum = ticketIdToEpic.get(ticketId);
    if (epicNum == null) {
      console.log('  Skip (inconnu):', issue.title?.slice(0, 50));
      skipped++;
      continue;
    }
    const parentNumber = epicNumToIssue[epicNum];
    if (!parentNumber) {
      console.log('  Skip (épic manquant):', ticketId);
      skipped++;
      continue;
    }
    try {
      const ok = addSubIssue(parentNumber, issue.id);
      if (ok) {
        console.log('  Lié:', ticketId, '#', issue.number, '→ Epic #' + parentNumber);
        linked++;
      } else {
        console.log('  Déjà lié ou erreur 422:', ticketId, '#', issue.number);
        skipped++;
      }
    } catch (e) {
      console.error('  Erreur #' + issue.number, e.message?.slice(0, 80));
      errors++;
    }
  }

  console.log('\nRésumé:');
  console.log('  Liés (relation Parent):', linked);
  console.log('  Ignorés:', skipped);
  if (errors) console.log('  Erreurs:', errors);
  if (dryRun) console.log('  (dry-run: aucune modification réelle)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
