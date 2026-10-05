import { execSync } from 'child_process';
import * as path from 'path';

const root = path.resolve(__dirname, '..');

interface AuditResult {
  file: string;
  line: number;
  content: string;
  type: 'any' | 'console.log';
}

function runAudit() {
  console.log('🔍 Running Project Quality Audit...');

  const results: AuditResult[] = [];
  const searchDirs = ['apps/client/src', 'apps/backend/src'];

  // Search for ': any'
  try {
    const rawAny = execSync(
      `grep -rn ": any" ${searchDirs.join(' ')} --exclude-dir=__tests__ --exclude-dir=coverage --exclude-dir=generated || true`,
      { encoding: 'utf8', cwd: root },
    );
    parseGrep(rawAny, 'any', results);
  } catch (e) {
    console.warn('Audit skip (grep unavailable?):', e);
  }

  // Search for 'console.log'
  try {
    const rawLogs = execSync(
      `grep -rn "console.log" ${searchDirs.join(' ')} --exclude-dir=coverage --exclude-dir=generated || true`,
      {
        encoding: 'utf8',
        cwd: root,
      },
    );
    parseGrep(rawLogs, 'console.log', results);
  } catch (e) {
    console.warn('Audit skip (grep unavailable?):', e);
  }

  if (results.length === 0) {
    console.log('✅ No quality issues found!');
    process.exit(0);
  }

  console.log(`\n❌ Found ${results.length} quality issues:`);

  const anyIssues = results.filter((r) => r.type === 'any');
  const logIssues = results.filter((r) => r.type === 'console.log');

  if (anyIssues.length > 0) {
    console.log(`\n📌 Remaining 'any' types (${anyIssues.length}):`);
    anyIssues.forEach((r) => console.log(`  ${r.file}:${r.line} -> ${r.content.trim()}`));
  }

  if (logIssues.length > 0) {
    console.log(`\n📌 Remaining 'console.log' (${logIssues.length}):`);
    logIssues.forEach((r) => console.log(`  ${r.file}:${r.line} -> ${r.content.trim()}`));
  }

  console.log('\n⚠️ Please refactor these issues to maintain high code quality.');
  process.exit(1);
}

const IGNORED_FILES = [
  'apps/client/src/utils/logger.ts', // Logger infrastructure - legitimately uses console
  'apps/client/src/config.ts', // Startup config logging (dev-only, intentional)
  'apps/client/src/services/analytics/AnalyticsService.ts', // Dev-only analytics debug logging, guarded by __DEV__
];

function shouldIgnore(file: string): boolean {
  return IGNORED_FILES.some((ignored) => file === ignored || file.startsWith(ignored));
}

function parseGrep(output: string, type: 'any' | 'console.log', results: AuditResult[]) {
  const lines = output.split('\n');
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split(':');
    if (parts.length >= 3) {
      const file = parts[0];
      const lineNumber = parseInt(parts[1]);
      const content = parts.slice(2).join(':');

      if (shouldIgnore(file)) continue;

      // Ignore comments or specific false positives
      if (content.trim().startsWith('//') || content.trim().startsWith('*')) continue;

      results.push({ file, line: lineNumber, content, type });
    }
  }
}

runAudit();
