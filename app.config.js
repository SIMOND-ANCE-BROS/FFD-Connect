/**
 * Config Expo pour EAS Build lancé depuis la racine du monorepo.
 * Réexporte apps/client/app.config.js en réécrivant les chemins relatifs
 * pour qu'ils soient relatifs à la racine du repo (pour que .easignore racine s'applique).
 */
const clientConfig = require('./apps/client/app.config.js');
const clientRoot = 'apps/client';

function rewritePath(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('./')) return `./${clientRoot}/${value.slice(2)}`;
  if (value.startsWith('.')) return `./${clientRoot}/${value.slice(1)}`;
  return value;
}

function rewritePaths(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(rewritePaths);
  if (typeof obj !== 'object') return obj;
  const res = {};
  for (const [k, v] of Object.entries(obj)) {
    if (
      typeof v === 'string' &&
      (k === 'icon' ||
        k === 'image' ||
        k === 'favicon' ||
        k === 'entryPoint' ||
        k === 'googleServicesFile' ||
        k === 'foregroundImage' ||
        k.endsWith('File'))
    ) {
      res[k] = rewritePath(v);
    } else if (k === 'splash' && v && typeof v === 'object') {
      res[k] = { ...v, image: rewritePath(v.image) };
    } else if (k === 'plugins' && Array.isArray(v)) {
      res[k] = v.map(p =>
        typeof p === 'string' && p.startsWith('./')
          ? `./${clientRoot}/${p.slice(2)}`
          : Array.isArray(p) && typeof p[0] === 'string' && p[0].startsWith('./')
            ? [`./${clientRoot}/${p[0].slice(2)}`, p[1]]
            : p,
      );
    } else if (
      typeof v === 'object' &&
      v !== null &&
      !(v instanceof RegExp) &&
      !(v instanceof Date)
    ) {
      res[k] = rewritePaths(v);
    } else {
      res[k] = v;
    }
  }
  return res;
}

module.exports = { expo: rewritePaths(clientConfig.expo) };
