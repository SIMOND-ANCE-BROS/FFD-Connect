#!/usr/bin/env tsx
/**
 * Script d'analyse de la couverture de tests
 *
 * Analyse la couverture de tests du backend et du client,
 * compare avec les seuils configurés et génère un rapport.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(PROJECT_ROOT, 'apps/backend');
const CLIENT_DIR = path.join(PROJECT_ROOT, 'apps/client');

interface CoverageMetrics {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

interface CoverageThreshold {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

interface CoverageReport {
  app: string;
  metrics: CoverageMetrics;
  threshold: CoverageThreshold;
  status: 'pass' | 'fail';
  details: {
    statements: { value: number; threshold: number; status: 'pass' | 'fail' };
    branches: { value: number; threshold: number; status: 'pass' | 'fail' };
    functions: { value: number; threshold: number; status: 'pass' | 'fail' };
    lines: { value: number; threshold: number; status: 'pass' | 'fail' };
  };
}

// Source de vérité : les configs Jest elles-mêmes
function loadThreshold(configPath: string): CoverageThreshold {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require(configPath) as {
    coverageThreshold?: { global?: Partial<CoverageThreshold> };
  };
  const g = config.coverageThreshold?.global ?? {};
  return {
    statements: g.statements ?? 80,
    branches: g.branches ?? 70,
    functions: g.functions ?? 80,
    lines: g.lines ?? 80,
  };
}

const BACKEND_THRESHOLD = loadThreshold(path.join(PROJECT_ROOT, 'apps/backend/jest.config.js'));
const CLIENT_THRESHOLD = loadThreshold(path.join(PROJECT_ROOT, 'apps/client/jest.config.js'));

function parseCoverageSummary(summaryPath: string): CoverageMetrics | null {
  if (!fs.existsSync(summaryPath)) {
    return null;
  }

  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const total = summary.total;

    return {
      statements: total.statements.pct,
      branches: total.branches.pct,
      functions: total.functions.pct,
      lines: total.lines.pct,
    };
  } catch (error) {
    console.error(`Erreur lors de la lecture de ${summaryPath}:`, error);
    return null;
  }
}

function compareCoverage(
  metrics: CoverageMetrics,
  threshold: CoverageThreshold,
): CoverageReport['details'] {
  return {
    statements: {
      value: metrics.statements,
      threshold: threshold.statements,
      status: metrics.statements >= threshold.statements ? 'pass' : 'fail',
    },
    branches: {
      value: metrics.branches,
      threshold: threshold.branches,
      status: metrics.branches >= threshold.branches ? 'pass' : 'fail',
    },
    functions: {
      value: metrics.functions,
      threshold: threshold.functions,
      status: metrics.functions >= threshold.functions ? 'pass' : 'fail',
    },
    lines: {
      value: metrics.lines,
      threshold: threshold.lines,
      status: metrics.lines >= threshold.lines ? 'pass' : 'fail',
    },
  };
}

function generateReport(report: CoverageReport): void {
  const { app, metrics, threshold, status, details } = report;

  console.log(`\n📊 Couverture de tests - ${app.toUpperCase()}`);
  console.log('─'.repeat(50));

  const formatMetric = (
    name: string,
    detail: CoverageReport['details'][keyof CoverageReport['details']],
  ) => {
    const icon = detail.status === 'pass' ? '✅' : '❌';
    const diff = detail.value - detail.threshold;
    const diffStr = diff >= 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`;
    return `${icon} ${name.padEnd(12)} ${detail.value.toFixed(1)}% / ${detail.threshold}% (${diffStr})`;
  };

  console.log(formatMetric('Statements', details.statements));
  console.log(formatMetric('Branches', details.branches));
  console.log(formatMetric('Functions', details.functions));
  console.log(formatMetric('Lines', details.lines));

  const allPass =
    details.statements.status === 'pass' &&
    details.branches.status === 'pass' &&
    details.functions.status === 'pass' &&
    details.lines.status === 'pass';

  console.log(`\n${allPass ? '✅' : '❌'} Statut global: ${allPass ? 'PASS' : 'FAIL'}`);
}

async function checkBackendCoverage(): Promise<CoverageReport | null> {
  console.log('\n🔍 Analyse de la couverture backend...');

  const summaryPath = path.join(BACKEND_DIR, 'coverage/coverage-summary.json');

  // Run tests if coverage doesn't exist
  if (!fs.existsSync(summaryPath)) {
    console.log('⚠️  Aucun rapport de couverture trouvé. Exécution des tests...');
    try {
      execSync('pnpm test:cov', {
        cwd: BACKEND_DIR,
        stdio: 'inherit',
      });
    } catch (error) {
      console.error("❌ Erreur lors de l'exécution des tests backend");
      return null;
    }
  }

  const metrics = parseCoverageSummary(summaryPath);
  if (!metrics) {
    console.error('❌ Impossible de parser le rapport de couverture backend');
    return null;
  }

  const details = compareCoverage(metrics, BACKEND_THRESHOLD);
  const allPass = Object.values(details).every((d) => d.status === 'pass');

  return {
    app: 'backend',
    metrics,
    threshold: BACKEND_THRESHOLD,
    status: allPass ? 'pass' : 'fail',
    details,
  };
}

async function checkClientCoverage(): Promise<CoverageReport | null> {
  console.log('\n🔍 Analyse de la couverture client...');

  const summaryPath = path.join(CLIENT_DIR, 'coverage/coverage-summary.json');

  // Run tests if coverage doesn't exist
  if (!fs.existsSync(summaryPath)) {
    console.log('⚠️  Aucun rapport de couverture trouvé. Exécution des tests...');
    try {
      execSync('pnpm test:cov', {
        cwd: CLIENT_DIR,
        stdio: 'inherit',
      });
    } catch (error) {
      console.error("❌ Erreur lors de l'exécution des tests client");
      return null;
    }
  }

  const metrics = parseCoverageSummary(summaryPath);
  if (!metrics) {
    console.error('❌ Impossible de parser le rapport de couverture client');
    return null;
  }

  const details = compareCoverage(metrics, CLIENT_THRESHOLD);
  const allPass = Object.values(details).every((d) => d.status === 'pass');

  return {
    app: 'client',
    metrics,
    threshold: CLIENT_THRESHOLD,
    status: allPass ? 'pass' : 'fail',
    details,
  };
}

async function main() {
  console.log('📈 Analyse de la couverture de tests FFD Connect\n');

  const backendReport = await checkBackendCoverage();
  const clientReport = await checkClientCoverage();

  if (backendReport) {
    generateReport(backendReport);
  }

  if (clientReport) {
    generateReport(clientReport);
  }

  const allPass =
    (!backendReport || backendReport.status === 'pass') &&
    (!clientReport || clientReport.status === 'pass');

  console.log('\n' + '═'.repeat(50));
  if (allPass) {
    console.log('✅ Tous les seuils de couverture sont atteints !');
  } else {
    console.log('❌ Certains seuils de couverture ne sont pas atteints.');
    console.log('💡 Exécutez les tests avec: pnpm test:cov');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Erreur:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
