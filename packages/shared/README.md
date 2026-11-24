# @ffd-connect/shared

Types et utilitaires partagés entre le backend et le client FFD Connect.

## Exports actuels

- **ID** : Type alias pour les identifiants uniques (UUID)
- **DANCE_CAPABILITIES**, **DanceCapability**, **isDanceCapability** : capacités d'un domaine de danse (ADR-0026). Le backend n'en importe que le type : `nest build` réécrit l'alias `@ffd-connect/shared` en chemin relatif, absent de l'image de production. Il garde donc sa propre liste, vérifiée à la compilation (`src/disciplines/dance-capabilities.ts`).

## Usage

```ts
import type { ID } from '@ffd-connect/shared';
```

## Extension

Ce package peut être enrichi avec d'autres types ou constantes partagés (DTOs, enums, constantes métier) pour réduire la duplication entre backend et client.
