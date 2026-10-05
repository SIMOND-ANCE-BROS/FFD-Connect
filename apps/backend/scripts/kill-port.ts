#!/usr/bin/env tsx
/**
 * Script pour libérer le port 3000 (ou un autre port spécifié)
 * Usage: tsx scripts/kill-port.ts [port]
 */

import { execSync } from "child_process";

const port = process.argv[2] ? parseInt(process.argv[2], 10) : 3000;

if (isNaN(port)) {
  console.error(`❌ Port invalide: ${process.argv[2]}`);
  process.exit(1);
}

function killPort(port: number): void {
  // Synchronous version without async/await
  try {
    console.warn(`🔍 Recherche des processus utilisant le port ${port}...`);

    const pids = execSync(`lsof -ti:${port}`, {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    if (!pids) {
      console.warn(`✅ Le port ${port} est libre`);
      return;
    }

    const pidList = pids.split("\n").filter(Boolean);
    console.warn(`📋 Processus trouvés: ${pidList.join(", ")}`);

    for (const pid of pidList) {
      try {
        const processName = execSync(`ps -p ${pid} -o comm=`, {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        console.warn(`   - PID ${pid}: ${processName}`);
      } catch (_e) {
        console.warn(`   - PID ${pid}: (nom non disponible)`);
      }
    }

    console.warn(`\n🛑 Arrêt des processus...`);
    try {
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: "ignore" });
    } catch (_killError) {
      // Si kill échoue, essayer avec sudo ou donner des instructions
      console.error(`⚠️  Impossible d'arrêter automatiquement. Essayez:`);
      console.error(`   kill -9 ${pidList.join(" ")}`);
      console.error(`   ou: sudo kill -9 ${pidList.join(" ")}`);
      process.exit(1);
    }

    // Vérifier que le port est maintenant libre (attendre un peu)
    try {
      execSync("sleep 0.5", { stdio: "pipe" });
    } catch {
      // sleep might not be available on all systems, use setTimeout equivalent
      const start = Date.now();
      while (Date.now() - start < 500) {
        // Busy wait
      }
    }

    const stillInUse = execSync(`lsof -ti:${port}`, {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    if (stillInUse) {
      console.error(`❌ Impossible de libérer le port ${port}`);
      console.error(
        `💡 Essayez manuellement: sudo kill -9 ${pidList.join(" ")}`,
      );
      process.exit(1);
    }

    console.warn(`✅ Port ${port} libéré avec succès`);
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; message?: string };
    if (err.status === 1 && err.stdout === "") {
      // lsof retourne 1 si aucun processus n'utilise le port
      console.warn(`✅ Le port ${port} est déjà libre`);
      return;
    }

    console.error(`❌ Erreur:`, err.message);
    console.error(`💡 Essayez manuellement: lsof -ti:${port} | xargs kill -9`);
    process.exit(1);
  }
}

try {
  killPort(port);
} catch (error: unknown) {
  const err = error as { message?: string };
  console.error("❌ Erreur fatale:", err.message ?? String(error));
  process.exit(1);
}
