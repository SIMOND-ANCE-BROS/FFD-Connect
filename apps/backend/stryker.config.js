// @ts-check

/**
 * Stryker Mutation Testing Configuration
 *
 * Cible les modules métier critiques uniquement :
 * - auth (login, tokens, reset de mot de passe)
 * - competitions/services (inscriptions, résultats, sync)
 * - common (guards, filtres, utilitaires)
 * - clubs (partenariats, inscriptions club)
 *
 * On exclut délibérément :
 * - config/ (env.validation testé séparément, pas de logique de branche)
 * - prisma/ (couche ORM, pas de logique métier)
 * - *.module.ts, *.dto.ts (boilerplate)
 * - scripts/ (utilitaires one-shot)
 *
 * Threshold fixé à 75% pour être exigeant sans être paralysant.
 * Augmenter progressivement à chaque sprint.
 */

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  packageManager: "pnpm",
  testRunner: "jest",
  jest: {
    projectType: "custom",
    configFile: "jest.config.stryker.js",
    enableFindRelatedTests: true,
  },
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",

  // Fichiers sources ciblés par la mutation
  mutate: [
    // Auth — cœur de la sécurité
    "src/auth/auth.service.ts",
    "src/auth/email.service.ts",
    "src/auth/guards/roles.guard.ts",

    // Competitions — logique métier principale
    "src/competitions/services/competition-registration.service.ts",
    "src/competitions/services/competition-results.service.ts",
    "src/competitions/services/competition-query.service.ts",
    "src/competitions/skating.util.ts",

    // Common — filtres et utilitaires transversaux
    "src/common/filters/http-exception.filter.ts",
    "src/common/age-group/age-group.util.ts",
    "src/common/participation-rules/participation-rules.util.ts",
    "src/common/solo-rules/solo-rules.util.ts",

    // Clubs
    "src/clubs/clubs.service.ts",

    // Utilitaires
    "src/utils/file-validation.util.ts",
  ],

  // Reporters
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: {
    fileName: "reports/mutation/mutation.html",
  },

  // Ignore static mutants (5% of total but 87% of runtime)
  ignoreStatic: true,

  // Incremental mode: reuse previous results, only re-test changed mutants
  incremental: true,
  incrementalFile: "reports/mutation/stryker-incremental.json",

  // Seuil : objectif progressif, remonter à chaque sprint
  thresholds: {
    high: 75,
    low: 65,
    break: 60, // Fail CI si on tombe sous 60% — remonter progressivement (+2% par sprint)
  },

  // Optimisations de performance (concurrency auto-detected from available CPUs)
  timeoutMS: 10000,
  timeoutFactor: 1.5,

  // Ignorer les mutations peu pertinentes
  mutator: {
    excludedMutations: [
      "StringLiteral", // Les messages d'erreur exacts ne sont pas critiques
      "ObjectLiteral", // Config objects — pas de logique de branche
    ],
  },

  // Dossier de cache pour accélérer les runs suivants
  tempDirName: ".stryker-tmp",
};
