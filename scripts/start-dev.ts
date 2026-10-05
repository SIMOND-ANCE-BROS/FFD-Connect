import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isDockerRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resetWatchman(): void {
  try {
    const projectRoot = path.resolve(__dirname, '..');
    execSync(`watchman watch-del '${projectRoot}'`, { stdio: 'ignore' });
    execSync(`watchman watch-project '${projectRoot}'`, { stdio: 'ignore' });
    console.log('✅ Watchman réinitialisé');
  } catch {
    // Watchman might not be installed or the watch might not exist
    // This is not critical, so we silently ignore
  }
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.once('close', () => resolve(false));
      server.close();
    });
    server.on('error', () => resolve(true));
  });
}

function getProcessUsingPort(port: number): string | null {
  try {
    // macOS/Linux: use lsof to find process using port
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

async function checkPorts(): Promise<void> {
  // Only check ports for services we start directly (not Docker services)
  const ports = [
    { port: 3000, name: 'Backend API' },
    { port: 8081, name: 'Metro bundler' },
  ];

  const issues: string[] = [];

  for (const { port, name } of ports) {
    const inUse = await isPortInUse(port);
    if (inUse) {
      const processInfo = getProcessUsingPort(port);
      if (processInfo) {
        issues.push(`⚠️  Port ${port} (${name}) est déjà utilisé par: ${processInfo}`);
      } else {
        issues.push(`⚠️  Port ${port} (${name}) est déjà utilisé`);
      }
    }
  }

  if (issues.length > 0) {
    console.log('\n⚠️  Des ports sont déjà utilisés :\n');
    issues.forEach((issue) => console.log(`   ${issue}`));

    // Check if processes are development processes (nest start, expo start, etc.)
    let shouldAutoKill = true;
    for (const { port } of ports) {
      const processInfo = getProcessUsingPort(port);
      if (processInfo) {
        const isDevProcess =
          processInfo.includes('nest') ||
          processInfo.includes('react-native') ||
          processInfo.includes('metro') ||
          processInfo.includes('node');
        if (!isDevProcess) {
          shouldAutoKill = false;
          break;
        }
      }
    }

    if (shouldAutoKill) {
      console.log('\n🛑 Arrêt automatique des processus de développement...');
      try {
        // Kill processes on ports 3000 and 8081
        try {
          const pids3000 = execSync(`lsof -ti:3000`, {
            encoding: 'utf8',
            stdio: 'pipe',
          }).trim();
          if (pids3000) {
            execSync(`lsof -ti:3000 | xargs kill -9`, { stdio: 'ignore' });
            console.log('✅ Processus sur le port 3000 arrêté');
          }
        } catch {}
        try {
          const pids8081 = execSync(`lsof -ti:8081`, {
            encoding: 'utf8',
            stdio: 'pipe',
          }).trim();
          if (pids8081) {
            execSync(`lsof -ti:8081 | xargs kill -9`, { stdio: 'ignore' });
            console.log('✅ Processus sur le port 8081 arrêté');
          }
        } catch {}
        console.log('⏳ Attente de la libération des ports...');
        await sleep(2000);
      } catch (error) {
        console.error("❌ Erreur lors de l'arrêt des processus:", error);
        process.exit(1);
      }
    } else {
      console.log('\n❌ Les ports sont utilisés par des processus non-développement.');
      console.log('💡 Solutions :');
      console.log('   1. Arrêtez les processus manuellement :');
      console.log(
        '      - Backend (port 3000): pkill -f "nest start" ou lsof -ti:3000 | xargs kill -9',
      );
      console.log(
        '      - Metro (port 8081): pkill -f "expo start" ou lsof -ti:8081 | xargs kill -9',
      );
      console.log('   2. Ou utilisez des ports différents dans votre configuration');
      console.log('   3. Ou arrêtez tous les processus avec: pnpm stop:dev\n');
      process.exit(1);
    }
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openTerminalWindow(command: string, title: string, cwd: string): void {
  // Use temp file approach to avoid all quoting issues with AppleScript
  const tmpDir = process.env.TMPDIR || '/tmp';
  const tmpFile = path.join(
    tmpDir,
    `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}.scpt`,
  );

  // Escape for AppleScript: escape backslashes first, then quotes
  const escapeForAppleScript = (str: string): string => {
    return str
      .replace(/\\/g, '\\\\') // Escape backslashes first
      .replace(/"/g, '\\"') // Escape double quotes
      .replace(/\$/g, '\\$'); // Escape dollar signs
  };

  const escapedCommand = escapeForAppleScript(command);
  const escapedCwd = escapeForAppleScript(cwd);
  const escapedTitle = escapeForAppleScript(title);

  // Create AppleScript - use double quotes and escape them properly
  // Simplified: just run the command without extra echo messages to avoid quote issues
  const appleScript = `tell application "Terminal"
  activate
  do script "cd \\"${escapedCwd}\\" && ${escapedCommand}"
  set custom title of front window to "${escapedTitle}"
end tell`;

  try {
    // Write script to temp file (avoids all shell quoting issues)
    fs.writeFileSync(tmpFile, appleScript, 'utf8');

    // Execute using temp file
    execSync(`osascript "${tmpFile}"`, { stdio: 'pipe' });

    // Clean up temp file
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }

    console.log(`   ✓ Terminal ouvert: ${title}`);
  } catch (error: any) {
    // Clean up temp file on error
    try {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }

    console.error(`❌ Impossible d'ouvrir un nouveau terminal pour ${title}`);
    console.error('   Vérifiez que Terminal.app est disponible sur macOS');
    if (error.message) {
      console.error(`   Erreur: ${error.message}`);
    }
    // Don't throw - allow script to continue even if terminal opening fails
  }
}

async function main() {
  // Check if ports are already in use
  await checkPorts();

  // Check if Docker is running
  if (!isDockerRunning()) {
    console.log("🐳 Docker n'est pas lancé. Démarrage de Docker Desktop...");
    try {
      execSync('open -a Docker', { stdio: 'ignore' });
    } catch {
      console.error('❌ Impossible de démarrer Docker Desktop automatiquement.');
      console.error('   Veuillez le démarrer manuellement et relancer le script.');
      process.exit(1);
    }

    // Wait for Docker to start
    console.log('⏳ En attente du démarrage de Docker...');
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes max

    while (!isDockerRunning() && attempts < maxAttempts) {
      await sleep(2000);
      process.stdout.write('.');
      attempts++;
    }
    console.log('');

    if (!isDockerRunning()) {
      console.error("❌ Docker n'a pas démarré dans les temps.");
      process.exit(1);
    }

    console.log('✅ Docker est prêt !');
  } else {
    console.log('✅ Docker tourne déjà.');
  }

  // Start only DB and Redis (backend runs locally via pnpm)
  console.log('🚀 Démarrage de la base de données et Redis...');
  const projectRoot = path.resolve(__dirname, '..');
  const dockerComposePath = path.join(projectRoot, 'docker-compose.yml');

  if (!fs.existsSync(dockerComposePath)) {
    console.error('❌ docker-compose.yml non trouvé');
    process.exit(1);
  }

  try {
    execSync('docker-compose up -d db redis', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('❌ Erreur lors du démarrage de Docker Compose');
    process.exit(1);
  }

  // Wait a bit for services to be ready
  await sleep(2000);

  // Reset Watchman if needed to avoid recrawl warnings
  resetWatchman();

  // Check if user wants separate terminals (via environment variable or ask)
  const useSeparateTerminals =
    process.env.SEPARATE_TERMINALS === 'true' ||
    process.argv.includes('--separate-terminals') ||
    process.argv.includes('-s');

  if (useSeparateTerminals) {
    console.log('');
    console.log('🚀 Démarrage des services dans des terminaux séparés...');

    const clientDir = path.join(projectRoot, 'apps', 'client');

    if (!fs.existsSync(clientDir)) {
      console.error('❌ Dossier apps/client non trouvé');
      process.exit(1);
    }

    // Open Metro bundler in separate terminal
    console.log('📱 Ouverture du Metro bundler dans un nouveau terminal...');
    openTerminalWindow('pnpm exec expo start --host lan', 'Metro Bundler', clientDir);

    // Wait a bit before opening next terminal
    await sleep(2000);

    // Double-check port 3000 is free before starting backend
    const port3000InUse = await isPortInUse(3000);
    if (port3000InUse) {
      const processInfo = getProcessUsingPort(3000);
      console.log(
        `\n⚠️  Le port 3000 est toujours utilisé par: ${processInfo || 'processus inconnu'}`,
      );
      console.log('🛑 Arrêt du processus existant...');
      try {
        execSync(`lsof -ti:3000 | xargs kill -9`, { stdio: 'pipe' });
        console.log('✅ Processus arrêté');
        await sleep(1000); // Wait for port to be released
      } catch (error) {
        console.error("❌ Impossible d'arrêter le processus sur le port 3000");
        console.error('   Veuillez l\'arrêter manuellement: pkill -f "nest start"');
        process.exit(1);
      }
    }

    // Update IP before starting backend
    console.log("🔧 Mise à jour de l'IP locale...");
    try {
      execSync('pnpm --filter backend exec tsx scripts/update-ip.ts', {
        cwd: projectRoot,
        stdio: 'pipe',
      });
    } catch (error) {
      console.warn("⚠️  Impossible de mettre à jour l'IP, continuation...");
    }

    // Open Backend in separate terminal
    console.log('💻 Ouverture du backend dans un nouveau terminal...');
    openTerminalWindow('pnpm --filter backend start:dev', 'Backend API', projectRoot);

    console.log('');
    console.log('✅ Environnement de développement démarré !');
    console.log('   - Metro bundler: http://localhost:8081 (terminal séparé)');
    console.log('   - Backend API: http://localhost:3000 (terminal séparé)');
    console.log('   - PostgreSQL: localhost:5432');
    console.log('   - Redis: localhost:6379');
    console.log('');
    console.log(
      '💡 Pour arrêter les services, fermez les terminaux ou utilisez Ctrl+C dans chaque terminal.',
    );
    console.log('   Ou utilisez: pkill -f "expo start" && pkill -f "nest start"');

    // Exit this script since services run in separate terminals
    process.exit(0);
  } else {
    // Original behavior: run everything in current terminal
    console.log('');
    console.log('📱 Démarrage du Metro bundler (React Native)...');
    const clientDir = path.join(projectRoot, 'apps', 'client');

    if (!fs.existsSync(clientDir)) {
      console.error('❌ Dossier apps/client non trouvé');
      process.exit(1);
    }

    const metroProcess = spawn('pnpm', ['exec', 'expo', 'start', '--host', 'lan'], {
      cwd: clientDir,
      stdio: 'inherit',
      shell: false, // Security: don't use shell to avoid command injection
    });

    // Wait for Metro to start
    await sleep(3000);

    console.log('');
    console.log('💻 Démarrage du backend...');

    // Double-check port 3000 is free before starting backend
    const port3000InUse = await isPortInUse(3000);
    if (port3000InUse) {
      const processInfo = getProcessUsingPort(3000);
      console.log(
        `\n⚠️  Le port 3000 est toujours utilisé par: ${processInfo || 'processus inconnu'}`,
      );
      console.log('🛑 Arrêt du processus existant...');
      try {
        execSync(`lsof -ti:3000 | xargs kill -9`, { stdio: 'pipe' });
        console.log('✅ Processus arrêté');
        await sleep(1000); // Wait for port to be released
      } catch (error) {
        console.error("❌ Impossible d'arrêter le processus sur le port 3000");
        console.error('   Veuillez l\'arrêter manuellement: pkill -f "nest start"');
        process.exit(1);
      }
    }

    // Update IP before starting backend to avoid triggering watch mode restart
    console.log("🔧 Mise à jour de l'IP locale...");
    try {
      execSync('pnpm --filter backend exec tsx scripts/update-ip.ts', {
        cwd: projectRoot,
        stdio: 'pipe',
      });
    } catch (error) {
      console.warn("⚠️  Impossible de mettre à jour l'IP, continuation...");
    }

    const backendProcess = spawn('pnpm', ['--filter', 'backend', 'start:dev'], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false, // Security: don't use shell to avoid command injection
    });

    console.log('');
    console.log('✅ Environnement de développement démarré !');
    console.log('   - Metro bundler: http://localhost:8081');
    console.log('   - Backend API: http://localhost:3000');
    console.log('   - PostgreSQL: localhost:5432');
    console.log('   - Redis: localhost:6379');
    console.log('');
    console.log(
      '💡 Astuce: Utilisez --separate-terminals pour démarrer chaque service dans un terminal séparé',
    );
    console.log('Appuyez sur Ctrl+C pour tout arrêter...');

    // Handle process termination
    const cleanup = () => {
      console.log('\n🛑 Arrêt des processus...');
      metroProcess.kill();
      backendProcess.kill();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Wait for both processes
    metroProcess.on('exit', (code) => {
      console.log(`Metro bundler s'est arrêté avec le code ${code}`);
      cleanup();
    });

    backendProcess.on('exit', (code) => {
      console.log(`Backend s'est arrêté avec le code ${code}`);
      cleanup();
    });
  }
}

main().catch((err) => {
  console.error('❌ Erreur:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
