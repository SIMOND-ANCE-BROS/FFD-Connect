# Audit des Dépendances

Date: 2026-04-03T07:14:46.511Z

## 📦 Packages Deprecated

⚠️ 16 package(s) deprecated trouvé(s):

- **engines** (unknown)
  - Raison: Starting with v0.73.0, this package is bundled directly inside @hey-api/openapi-ts.

- **'@tanstack/react-query'** (unknown)
  - Raison: |-

- **resolution** (unknown)
  - Raison: This is a stub types definition. nock provides its own type definitions, so you do not need this installed.

- **resolution** (unknown)
  - Raison: Use your platform's native atob() and btoa() methods instead

- **dom-serializer@2.0.0** (unknown)
  - Raison: Use your platform's native DOMException instead

- **flattie@1.1.1** (unknown)
  - Raison: Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.

- **glob-parent@6.0.2** (unknown)
  - Raison: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

- **glob-parent@6.0.2** (unknown)
  - Raison: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

- **glob-parent@6.0.2** (unknown)
  - Raison: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

- **imurmurhash@0.1.4** (unknown)
  - Raison: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.

- **dom-serializer@2.0.0** (unknown)
  - Raison: Use your platform's native DOMException instead

- **react-native** (unknown)
  - Raison: 'This package is deprecated; please refer to the GitHub README for more information: https://github.com/douglasjunior/react-native-keyboard-manager'

- **reusify@1.1.0** (unknown)
  - Raison: Rimraf versions prior to v4 are no longer supported

- **flattie@1.1.1** (unknown)
  - Raison: Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.

- **resolution** (unknown)
  - Raison: no longer maintained

- **resolution** (unknown)
  - Raison: Use @exodus/bytes instead for a more spec-conformant and faster implementation

## 🔒 Vulnérabilités

✅ Aucune vulnérabilité critique identifiée.

## 🔄 Packages Obsolètes

✅ Tous les packages sont à jour.

## 💡 Recommandations

1. **Mettre à jour les packages deprecated** dès que possible
2. **Corriger les vulnérabilités** avec `pnpm audit --fix`
3. **Mettre à jour les packages obsolètes** progressivement
4. **Tester après chaque mise à jour** pour éviter les régressions
5. **Surveiller les dépendances critiques** (NestJS, React, Prisma, etc.)
