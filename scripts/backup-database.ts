import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function info(message: string) {
  console.log(`${GREEN}✓${RESET} ${message}`);
}

function warn(message: string) {
  console.log(`${YELLOW}⚠${RESET} ${message}`);
}

function error(message: string) {
  console.log(`${RED}✗${RESET} ${message}`);
}

function note(message: string) {
  console.log(`${BLUE}ℹ${RESET} ${message}`);
}

function question(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    }),
  );
}

async function main() {
  console.log("💾 Création d'un backup de la base de données");
  console.log('==============================================');
  console.log('');

  // Vérifier que nous sommes dans le bon répertoire
  let projectRoot = process.cwd();
  if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
    const backendPath = path.join(projectRoot, 'apps', 'backend');
    if (fs.existsSync(path.join(backendPath, 'package.json'))) {
      process.chdir(backendPath);
      projectRoot = backendPath;
    } else {
      error('Ce script doit être exécuté depuis la racine du projet ou apps/backend');
      process.exit(1);
    }
  }

  // Charger DATABASE_URL depuis .env
  const envPath = path.join(projectRoot, '.env');
  let databaseUrl = process.env.DATABASE_URL;

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^DATABASE_URL=(.+)$/m);
    if (match) {
      databaseUrl = match[1].trim();
    }
  }

  if (!databaseUrl) {
    error('DATABASE_URL non trouvé');
    error('Vérifiez votre fichier .env');
    process.exit(1);
  }

  // Vérifier si pg_dump est disponible
  try {
    execSync('pg_dump --version', { stdio: 'ignore' });
  } catch {
    warn("pg_dump n'est pas installé");
    console.log('');
    note('Options pour installer PostgreSQL:');
    console.log('');
    console.log('macOS (Homebrew):');
    console.log('  brew install postgresql@15');
    console.log('');
    console.log('Linux (Ubuntu/Debian):');
    console.log('  sudo apt-get install postgresql-client');
    console.log('');
    console.log('Linux (Fedora/RHEL):');
    console.log('  sudo dnf install postgresql');
    console.log('');
    console.log('Windows:');
    console.log('  Téléchargez depuis: https://www.postgresql.org/download/windows/');
    console.log('');
    warn("Vous pouvez continuer sans backup, mais c'est recommandé d'en faire un");
    const answer = await question('Continuer sans backup ? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      error('Annulé. Installez PostgreSQL et réessayez.');
      process.exit(1);
    }
    process.exit(0);
  }

  // Créer le dossier backups s'il n'existe pas
  const backupDir = path.join(projectRoot, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Nom du fichier de backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
  const backupFile = path.join(backupDir, `backup_${timestamp}.sql`);

  info('Création du backup...');
  note(`Fichier: ${backupFile}`);

  try {
    execSync(`pg_dump "${databaseUrl}" > "${backupFile}"`, {
      stdio: 'inherit',
      shell: true,
    });

    const stats = fs.statSync(backupFile);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    info('Backup créé avec succès');
    info(`Taille: ${sizeMB} MB`);
    info(`Fichier: ${backupFile}`);
    console.log('');
    note('Pour restaurer ce backup:');
    note(`  psql \$DATABASE_URL < ${backupFile}`);
  } catch (err) {
    error('Échec de la création du backup');
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  error(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
