// @ts-check
const { FlatCompat } = require("@eslint/eslintrc");
const tseslint = require("typescript-eslint");
const shared = require("../../packages/eslint-config/react-native");
const globals = require("globals");

// FlatCompat lets us use legacy configs that don't support flat config yet
// (@react-native, eslint-plugin-react-native-a11y)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: __dirname,
});

module.exports = tseslint.config(
  {
    // Duplicate .test.ts + .test.tsx pairs: TS project only resolves one; skip the .tsx copies for ESLint.
    ignores: [
      "eslint.config.js",
      "node_modules/**",
      "coverage/**",
      "**/useLoginLogic.test.tsx",
      "**/useCompetitionsLogic.test.tsx",
      "**/__mocks__/**",
      "e2e/**",
      "openapi-ts.config.ts",
      "**/__tests__/mocks/**",
      "**/src/__tests__/mocks/**",
      "src/api/generated/**",
    ],
  },
  // Legacy configs via compat layer
  // Filter out ft-flow plugin: not compatible with ESLint 9 (removed context.getAllComments)
  // and not needed since the project uses TypeScript instead of Flow.
  ...compat.extends("plugin:react-native-a11y/basic").map((cfg) => {
    // Filter out ft-flow plugin (not compatible with ESLint 9)
    const plugins = cfg.plugins ?? {};
    const { "ft-flow": _removedFtFlow, ...filteredPlugins } = plugins;
    const rules = Object.fromEntries(
      Object.entries(cfg.rules ?? {}).filter(
        ([k]) => !k.startsWith("ft-flow/"),
      ),
    );
    return { ...cfg, plugins: filteredPlugins, rules };
  }),
  // TypeScript-aware rules for .ts/.tsx files
  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
    ...cfg,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        globalThis: "readonly",
      },
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
        sourceType: "module",
      },
    },
    rules: {
      ...shared.rules,
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    // Test files
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "__mocks__/**/*.js",
      "jest.*.js",
    ],
    languageOptions: {
      globals: {
        ...globals.jest,
        globalThis: "readonly",
      },
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
);
