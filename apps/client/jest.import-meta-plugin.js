// Babel plugin used by Jest ONLY for msw 3 and its ESM-only dependencies
// (see the `transform` entry in jest.config.js).
//
// Jest runs the client suites as CommonJS (jest 29 is pinned by jest-expo), so
// the ESM sources are transpiled to CJS by babel-jest. `import.meta` has no
// CJS equivalent and babel-preset-expo refuses it on native platforms ("not
// supported in Hermes"). @mswjs/interceptors needs `import.meta.url` to read
// its llhttp WASM file from disk, so rewrite it to the module's own file URL:
//   import.meta  ->  ({ url: require("node:url").pathToFileURL(__filename).href })
module.exports = function importMetaToFileUrl({ types: t }) {
  return {
    name: "jest-import-meta-to-file-url",
    visitor: {
      MetaProperty(path) {
        const { node } = path;
        if (node.meta.name !== "import" || node.property.name !== "meta") {
          return;
        }
        const fileUrl = t.memberExpression(
          t.callExpression(
            t.memberExpression(
              t.callExpression(t.identifier("require"), [
                t.stringLiteral("node:url"),
              ]),
              t.identifier("pathToFileURL"),
            ),
            [t.identifier("__filename")],
          ),
          t.identifier("href"),
        );
        path.replaceWith(
          t.objectExpression([t.objectProperty(t.identifier("url"), fileUrl)]),
        );
      },
    },
  };
};
