#!/usr/bin/env tsx
/**
 * Script pour arrêter tous les services de développement
 * Arrête les processus sur les ports 3000 (backend) et 8081 (Metro)
 * et arrête les conteneurs Docker si nécessaire
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function getProcessUsingPort(port: number): string | null {
  try {
    const result = execSync(`lsof -ti:${port}`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (result) {
      const pid = result.split('\n')[0];
      try {
        const processName = execSync(`ps -p ${pid} -o comm=`, {
          encoding: 'utf8',
          stdio: 'pipe',
        }).trim();
        return `${processName} (PID: ${pid})`;
      } catch {
        return `PID: ${pid}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function killProcessOnPort(port: number, serviceName: string): boolean {
  try {
    const pids = execSync(`lsof -ti:${port}`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (!pids) {
      console.log(`✅ Port ${port} (${serviceName}) est déjà libre`);
      return true;
    }

    const pidList = pids.split('\n').filter(Boolean);
    console.log(`🛑 Arrêt de ${serviceName} sur le port ${port}...`);
    console.log(`   Processus trouvés: ${pidList.join(', ')}`);

    // Try graceful kill first (SIGTERM)
    try {
      execSync(`lsof -ti:${port} | xargs kill`, { stdio: 'pipe' });
      // Wait a bit for graceful shutdown
      execSync('sleep 1', { stdio: 'pipe' });
    } catch {
      // Ignore if graceful kill fails
    }

    // Check if still running and force kill if needed
    const stillRunning = execSync(`lsof -ti:${port}`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (stillRunning) {
      console.log(`   ⚠️  Arrêt forcé nécessaire...`);
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'pipe' });
      execSync('sleep 0.5', { stdio: 'pipe' });
    }

    // Verify port is free
    const finalCheck = execSync(`lsof -ti:${port}`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (finalCheck) {
      console.error(`   ❌ Impossible d'arrêter le processus sur le port ${port}`);
      console.error(`   💡 Essayez manuellement: kill -9 ${pidList.join(' ')}`);
      return false;
    }

    console.log(`   ✅ ${serviceName} arrêté avec succès`);
    return true;
  } catch (error: any) {
    if (error.status === 1 && error.stdout === '') {
      // lsof returns 1 if no process uses the port
      console.log(`✅ Port ${port} (${serviceName}) est déjà libre`);
      return true;
    }

    console.error(`   ❌ Erreur lors de l'arrêt de ${serviceName}:`, error.message);
    return false;
  }
}

function killProcessesByName(pattern: string, serviceName: string): void {
  try {
    // Try to find processes matching the pattern
    const result = execSync(`pgrep -f "${pattern}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (!result) {
      console.log(`✅ Aucun processus ${serviceName} trouvé`);
      return;
    }

    const pids = result.split('\n').filter(Boolean);
    console.log(`🛑 Arrêt des processus ${serviceName}...`);
    console.log(`   PIDs trouvés: ${pids.join(', ')}`);

    // Try graceful kill first
    try {
      execSync(`pkill -f "${pattern}"`, { stdio: 'pipe' });
      execSync('sleep 1', { stdio: 'pipe' });
    } catch {
      // Ignore if graceful kill fails
    }

    // Force kill if still running
    const stillRunning = execSync(`pgrep -f "${pattern}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (stillRunning) {
      execSync(`pkill -9 -f "${pattern}"`, { stdio: 'pipe' });
    }

    console.log(`   ✅ ${serviceName} arrêté`);
  } catch (error: any) {
    if (error.status === 1) {
      // pgrep returns 1 if no process found
      console.log(`✅ Aucun processus ${serviceName} trouvé`);
      return;
    }
    console.error(`   ⚠️  Erreur lors de l'arrêt de ${serviceName}:`, error.message);
  }
}

async function main() {
  console.log('🛑 Arrêt des services de développement...\n');

  // Stop processes on specific ports
  const port3000Free = killProcessOnPort(3000, 'Backend API');
  const port8081Free = killProcessOnPort(8081, 'Metro Bundler');

  console.log('');

  // Also try to kill by process name (in case they're running but not on expected ports)
  killProcessesByName('nest start', 'Backend (NestJS)');
  killProcessesByName('expo start', 'Metro Bundler');
  killProcessesByName('node.*metro', 'Metro Bundler');

  console.log('');

  // Optionally stop Docker containers
  const stopDocker = process.argv.includes('--docker') || process.argv.includes('-d');

  if (stopDocker) {
    console.log('🐳 Arrêt des conteneurs Docker...');
    try {
      execSync('docker-compose down', {
        cwd: projectRoot,
        stdio: 'inherit',
      });
      console.log('✅ Conteneurs Docker arrêtés');
    } catch (error) {
      console.error("⚠️  Erreur lors de l'arrêt des conteneurs Docker:", error);
    }
  } else {
    console.log('💡 Pour arrêter aussi Docker, utilisez: pnpm stop:dev --docker');
  }

  console.log('');
  console.log('✅ Arrêt terminé !');
  console.log('');
  console.log('💡 Si des processus tournent toujours, vérifiez avec:');
  console.log('   - lsof -ti:3000 (backend)');
  console.log('   - lsof -ti:8081 (Metro)');
  console.log('   - pgrep -f "nest start"');
  console.log('   - pgrep -f "expo start"');
}

main().catch((error) => {
  console.error('❌ Erreur fatale:', error);
  process.exit(1);
});
