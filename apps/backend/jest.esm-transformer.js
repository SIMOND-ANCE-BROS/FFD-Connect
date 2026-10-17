/**
 * Jest transformer for the ESM-only TEST dependencies (#721).
 *
 * nock 15 and its interceptor stack are published as `"type": "module"` only;
 * Jest's CommonJS runtime (ts-jest, CommonJS — the whole backend can't move
 * to ESM while NestJS 12 is blocked) cannot load them. This transformer
 * transpiles those files, and only those (`transformIgnorePatterns`), to
 * CommonJS with the TypeScript compiler already used by ts-jest — no Babel.
 *
 * `import.meta.url` has no CommonJS equivalent in TypeScript's output; it is
 * rewritten to the file's own URL (`@mswjs/interceptors` reads its WASM HTTP
 * parser next to the module with it).
 */
const crypto = require("crypto");
const fs = require("fs");
const ts = require("typescript");

/** This file's source: a change here invalidates Jest's transform cache. */
const SELF = fs.readFileSync(__filename);

/** Packages published as ESM only, loaded by the tests (nock and its deps). */
const ESM_ONLY_TEST_DEPS = [
  "nock",
  "@mswjs/interceptors",
  "@open-draft/until",
  "rettime",
];

/** `transformIgnorePatterns` entry: ignore node_modules except the above. */
const esmOnlyTransformIgnorePattern = `/node_modules/(?!(${ESM_ONLY_TEST_DEPS.join("|")})/)`;

const IMPORT_META_URL = /\bimport\.meta\.url\b/g;
const FILE_URL = 'require("node:url").pathToFileURL(__filename).href';

const compilerOptions = {
  allowJs: true,
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  sourceMap: false,
};

module.exports = {
  ESM_ONLY_TEST_DEPS,
  esmOnlyTransformIgnorePattern,
  getCacheKey(sourceText, sourcePath) {
    return crypto
      .createHash("sha256")
      .update(SELF)
      .update("\0")
      .update(ts.version)
      .update("\0")
      .update(sourcePath)
      .update("\0")
      .update(sourceText)
      .digest("hex");
  },
  process(sourceText, sourcePath) {
    const { outputText } = ts.transpileModule(
      sourceText.replace(IMPORT_META_URL, FILE_URL),
      { compilerOptions, fileName: sourcePath.replace(/\.mjs$/, ".js") },
    );
    return { code: outputText };
  },
};
