// lint-staged config — uses function form to exclude auto-generated files from ESLint
const path = require('path');

/** Filter out generated files that don't pass strict ESLint. */
const excludeGenerated = (files) => files.filter((f) => !f.includes(path.join('api', 'generated')));

module.exports = {
  // Catch-all: format any staged file Prettier understands (md, json, yml, css, etc.)
  '*.{md,json,yml,yaml,css}': ['prettier --write'],
  'apps/**/*.{md,json,yml,yaml,css}': ['prettier --write'],
  'docs/**/*.md': ['prettier --write'],
  'apps/backend/src/**/*.ts': ['eslint --fix -c apps/backend/eslint.config.js', 'prettier --write'],
  'apps/client/src/**/*.{ts,tsx}': (files) => {
    const filtered = excludeGenerated(files);
    if (filtered.length === 0) return [];
    return [
      `eslint --fix -c apps/client/eslint.config.js ${filtered.join(' ')}`,
      `prettier --write ${filtered.join(' ')}`,
    ];
  },
  'apps/landing/**/*.{ts,tsx}': [
    'eslint --fix -c apps/landing/eslint.config.js',
    'prettier --write',
  ],
  'scripts/**/*.ts': ['prettier --write'],
  'apps/backend/test/**/*.ts': [
    'eslint --fix -c apps/backend/eslint.config.js',
    'prettier --write',
  ],
  // Backend scripts: prettier only (ESLint relaxed rules don't resolve correctly
  // from monorepo root — CI handles linting with correct cwd)
  'apps/backend/scripts/**/*.ts': ['prettier --write'],
};
