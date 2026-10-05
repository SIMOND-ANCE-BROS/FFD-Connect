#!/usr/bin/env tsx
/**
 * Script de configuration automatique de l'environnement de développement
 *
 * Ce script automatise la configuration initiale du projet :
 * - Détection et mise à jour de l'IP locale
 * - Vérification des prérequis (Node.js, pnpm, Docker)
 * - Validation des variables d'environnement
 * - Configuration des ports
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLIENT_CONFIG_PATH = path.join(PROJECT_ROOT, 'apps/client/src/config.ts');
const BACKEND_ENV_EXAMPLE = path.join(PROJECT_ROOT, 'apps/backend/.env.example');
const BACKEND_ENV = path.join(PROJECT_ROOT, 'apps/backend/.env');

interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
}

const checks: CheckResult[] = [];

function checkNodeVersion(): CheckResult {
  try {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0]);
    if (major >= 20) {
      return { name: 'Node.js', status: 'ok', message: `Version ${version} ✓` };
    }
    return {
      name: 'Node.js',
      status: 'error',
      message: `Version ${version} - Requis: >= 20`,
    };
  } catch {
    return {
      name: 'Node.js',
      status: 'error',
      message: 'Node.js non trouvé',
    };
  }
}

function checkPnpm(): CheckResult {
  try {
    const version = execSync('pnpm --version', { encoding: 'utf8' }).trim();
    const major = parseInt(version.split('.')[0]);
    if (major >= 9) {
      return { name: 'pnpm', status: 'ok', message: `Version ${version} ✓` };
    }
    return {
      name: 'pnpm',
      status: 'error',
      message: `Version ${version} - Requis: >= 9`,
    };
  } catch {
    return {
      name: 'pnpm',
      status: 'error',
      message: 'pnpm non trouvé. Installez-le avec: npm install -g pnpm',
    };
  }
}

function checkDocker(): CheckResult {
  try {
    execSync('docker --version', { stdio: 'ignore' });
    try {
      execSync('docker info', { stdio: 'ignore' });
      return { name: 'Docker', status: 'ok', message: 'Installé et démarré ✓' };
    } catch {
      return {
        name: 'Docker',
        status: 'warning',
        message: 'Installé mais non démarré. Démarrez Docker Desktop.',
      };
    }
  } catch {
    return {
      name: 'Docker',
      status: 'error',
      message: 'Docker non trouvé. Installez Docker Desktop.',
    };
  }
}

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;

    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function updateClientConfigIp(ip: string): void {
  if (!fs.existsSync(CLIENT_CONFIG_PATH)) {
    console.warn(`⚠️  Fichier de config client non trouvé: ${CLIENT_CONFIG_PATH}`);
    return;
  }

  let content = fs.readFileSync(CLIENT_CONFIG_PATH, 'utf8');
  const regex = /const LOCAL_IP = '.*'; \/\/ Updated automatically/;
  const match = content.match(regex);

  if (match) {
    const currentIp = match[0].match(/'([^']+)'/)?.[1];

    if (currentIp !== ip) {
      const replacement = `const LOCAL_IP = '${ip}'; // Updated automatically`;
      content = content.replace(regex, replacement);
      fs.writeFileSync(CLIENT_CONFIG_PATH, content);
      console.log(`✅ IP locale mise à jour: ${currentIp} → ${ip}`);
    } else {
      console.log(`✅ IP locale déjà correcte: ${ip}`);
    }
  } else {
    console.warn('⚠️  Format LOCAL_IP non trouvé dans la config client');
  }
}

function checkBackendEnv(): CheckResult {
  if (!fs.existsSync(BACKEND_ENV)) {
    if (fs.existsSync(BACKEND_ENV_EXAMPLE)) {
      return {
        name: "Variables d'environnement",
        status: 'warning',
        message: `.env manquant. Copiez .env.example vers .env et configurez-le.`,
      };
    }
    return {
      name: "Variables d'environnement",
      status: 'error',
      message: '.env manquant et .env.example introuvable',
    };
  }

  // Check for required variables
  const envContent = fs.readFileSync(BACKEND_ENV, 'utf8');
  const requiredVars = ['DATABASE_URL', 'JWT_SECRET'];
  const missing: string[] = [];

  for (const varName of requiredVars) {
    if (!envContent.includes(`${varName}=`)) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    return {
      name: "Variables d'environnement",
      status: 'warning',
      message: `Variables manquantes: ${missing.join(', ')}`,
    };
  }

  return {
    name: "Variables d'environnement",
    status: 'ok',
    message: 'Configurées ✓',
  };
}

function printSummary(): void {
  console.log('\n📋 Résumé de la configuration:\n');

  const errors = checks.filter((c) => c.status === 'error');
  const warnings = checks.filter((c) => c.status === 'warning');
  const ok = checks.filter((c) => c.status === 'ok');

  ok.forEach((check) => {
    console.log(`  ✅ ${check.name}: ${check.message}`);
  });

  warnings.forEach((check) => {
    console.log(`  ⚠️  ${check.name}: ${check.message}`);
  });

  errors.forEach((check) => {
    console.log(`  ❌ ${check.name}: ${check.message}`);
  });

  console.log('');

  if (errors.length > 0) {
    console.log('❌ Des erreurs doivent être corrigées avant de continuer.\n');
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log('⚠️  Des avertissements doivent être vérifiés.\n');
  } else {
    console.log('✅ Tous les prérequis sont satisfaits !\n');
  }
}

async function main() {
  console.log("🔧 Configuration de l'environnement de développement FFD Connect\n");

  // Run checks
  checks.push(checkNodeVersion());
  checks.push(checkPnpm());
  checks.push(checkDocker());
  checks.push(checkBackendEnv());

  // Update IP
  const ip = getLocalIp();
  console.log(`\n🌐 Détection de l'IP locale: ${ip}`);
  updateClientConfigIp(ip);

  // Print summary
  printSummary();

  console.log('💡 Prochaines étapes:');
  console.log("   1. Configurez vos variables d'environnement dans apps/backend/.env");
  console.log('   2. Installez les dépendances: pnpm install');
  console.log('   3. Démarrez Docker Desktop si nécessaire');
  console.log('   4. Lancez les migrations: cd apps/backend && pnpm exec prisma migrate dev');
  console.log('   5. Démarrez le projet: pnpm start:dev\n');
}

main().catch((err) => {
  console.error('❌ Erreur:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
