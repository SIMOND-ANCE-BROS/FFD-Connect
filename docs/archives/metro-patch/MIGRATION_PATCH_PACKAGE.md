# Patches Metro/Expo avec pnpm patch

## Situation actuelle

Le projet utilise **pnpm patch** (natif) pour versionner les modifications Metro/Expo. Les patches sont dans `patches/` et référencés dans `pnpm.patchedDependencies` du `package.json`.

## Workflow

### Application des patches

À chaque `pnpm install`, pnpm applique automatiquement les patches. Aucun script postinstall n'est nécessaire pour les patches.

### Régénération des patches

Après une mise à jour d'Expo, Metro ou des packages associés, les patches peuvent ne plus s'appliquer. Pour régénérer :

```bash
pnpm run generate-patches
```

Ce script utilise `pnpm patch` + `patch-metro-cache.cjs` (mode `--target-dir`) pour créer les fichiers `.patch`.

### Régénération manuelle (un package)

```bash
# 1. Ouvrir le package pour modification
pnpm patch metro@0.83.3

# 2. Appliquer les modifications
node scripts/patch-metro-cache.cjs --package metro --target-dir "node_modules/.pnpm_patches/metro@0.83.3"

# 3. Valider le patch
pnpm patch-commit "node_modules/.pnpm_patches/metro@0.83.3"
```

## Structure

- `patches/*.patch` : fichiers diff (format git)
- `scripts/patch-metro-cache.cjs` : logique de patching, supporte `--package` et `--target-dir`
- `scripts/generate-patches.ts` : orchestration pnpm patch pour les 7 packages
- `scripts/link-babel-runtime.cjs` : copie @babel/runtime (postinstall)

## Pourquoi pas patch-package ?

patch-package requiert un `package-lock.json` ou `yarn.lock` et n'est pas compatible avec pnpm. pnpm patch est la solution native recommandée.
