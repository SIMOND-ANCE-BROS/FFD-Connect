// Checks that a deployed node_modules tree only contains versions pinned by a
// pnpm lockfile (#692). Run INSIDE the backend image by docker-build-check:
//
//   node check-image-lockfile.mjs <node_modules dir> <pnpm-lock.yaml>
//
// Every installed package (name + version read from its own package.json, so
// npm aliases such as `string-width-cjs` resolve to their real name) must match
// a key of the lockfile's `packages:` section. Workspace packages
// (@ffd-connect/*) and the deployed project itself are skipped: they are
// injected from the workspace, not resolved from the registry.
//
// No dependency on purpose: the runtime image has node and nothing else (no
// pnpm, no npm), and the lockfile is read with a line-oriented scan rather than
// a YAML parser.
import fs from 'node:fs';
import path from 'node:path';

const [modulesDir, lockPath] = process.argv.slice(2);
if (!modulesDir || !lockPath) {
  console.error('usage: node check-image-lockfile.mjs <node_modules dir> <pnpm-lock.yaml>');
  process.exit(2);
}

const installed = new Set();
function visitPackage(pkgDir) {
  const manifest = path.join(pkgDir, 'package.json');
  if (fs.existsSync(manifest)) {
    try {
      const { name, version } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (name && version) installed.add(`${name}@${version}`);
    } catch {
      // Not a package root (fixture or partial file): ignore.
    }
  }
  walk(path.join(pkgDir, 'node_modules'));
}
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.')) continue; // .bin, .pnpm, .modules.yaml
    const full = path.join(dir, entry);
    if (entry.startsWith('@')) {
      for (const scoped of fs.readdirSync(full)) visitPackage(path.join(full, scoped));
    } else {
      visitPackage(full);
    }
  }
}
walk(modulesDir);

const lock = fs.readFileSync(lockPath, 'utf8');
const packagesSection = lock.split(/^packages:\s*$/m)[1]?.split(/^snapshots:\s*$/m)[0];
if (!packagesSection) {
  console.error(`No packages: section found in ${lockPath}`);
  process.exit(2);
}
const locked = new Set();
for (const m of packagesSection.matchAll(/^ {2}'?((?:@[^/\s]+\/)?[^@\s']+)@([^:'(\s]+)/gm)) {
  locked.add(`${m[1]}@${m[2]}`);
}

const unlocked = [...installed]
  .filter((id) => !id.startsWith('@ffd-connect/') && !id.startsWith('backend@'))
  .filter((id) => !locked.has(id))
  .sort();

// A wrong path would otherwise pass vacuously.
if (installed.size < 100) {
  console.error(`Only ${installed.size} packages found under ${modulesDir}: wrong path?`);
  process.exit(2);
}
if (unlocked.length > 0) {
  console.error(
    `${unlocked.length} of ${installed.size} installed package versions are not pinned by ${lockPath}:`,
  );
  for (const id of unlocked) console.error(`  ${id}`);
  console.error('The image did not install from the lockfile (pnpm deploy --legacy is back?).');
  process.exit(1);
}
console.log(`OK: all ${installed.size} installed package versions are pinned by the lockfile.`);
