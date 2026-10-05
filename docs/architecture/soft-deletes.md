# Soft Deletes - Guide d'Implémentation

> ⚠️ **Statut : proposition, non implémentée.** Ce document décrit un design envisagé ; le code actuel n'a pas de middleware Prisma de soft-delete. À traiter comme référence de conception.

## Vue d'ensemble

Les soft deletes permettent de marquer des enregistrements comme "supprimés" sans les supprimer réellement de la base de données. Cela permet de :

- Conserver l'historique des données
- Permettre la restauration de données supprimées par erreur
- Respecter les exigences de conformité (RGPD, audit)

## Modèles concernés

### Modèles qui pourraient bénéficier de soft deletes :

1. **User** - Pour conserver l'historique des utilisateurs
2. **Competition** - Pour conserver l'historique des compétitions passées
3. **Registration** - Pour conserver l'historique des inscriptions (actuellement supprimées définitivement)
4. **License** - Pour conserver l'historique des licences

### Modèles qui ne nécessitent PAS de soft deletes :

- **RefreshToken** - Suppression normale (nettoyage automatique)
- **Notification** - Peut être supprimé définitivement après lecture
- **Track** - Peut être supprimé définitivement

## Implémentation

### 1. Ajouter les champs au schéma Prisma

```prisma
model User {
  id              String         @id @default(uuid())
  // ... autres champs
  deletedAt       DateTime?      // Soft delete timestamp
  deletedBy        String?        // ID de l'utilisateur qui a supprimé

  @@index([deletedAt])
}
```

### 2. Créer un middleware Prisma

```typescript
// src/prisma/prisma-soft-delete.middleware.ts
import { Prisma } from '@prisma/client';

export function softDeleteMiddleware(models: string[] = ['User', 'Competition', 'Registration']) {
  return async (
    params: Prisma.MiddlewareParams,
    next: (params: Prisma.MiddlewareParams) => Promise<any>,
  ) => {
    // Filtrer automatiquement les enregistrements supprimés
    if (
      params.action === 'findMany' ||
      params.action === 'findFirst' ||
      params.action === 'findUnique'
    ) {
      if (models.includes(params.model || '')) {
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      }
    }

    // Transformer les delete en update
    if (params.action === 'delete' || params.action === 'deleteMany') {
      if (models.includes(params.model || '')) {
        params.action = 'update';
        params.args.data = {
          deletedAt: new Date(),
        };
      }
    }

    return next(params);
  };
}
```

### 3. Utiliser dans PrismaService

```typescript
// src/prisma/prisma.service.ts
constructor() {
  this.$use(softDeleteMiddleware(['User', 'Competition', 'Registration']));
}
```

## Utilisation

### Suppression soft

```typescript
// Au lieu de delete
await prisma.user.delete({ where: { id: userId } });

// Utiliser update
await prisma.user.update({
  where: { id: userId },
  data: { deletedAt: new Date(), deletedBy: currentUserId },
});
```

### Récupération avec soft deletes

Par défaut, les enregistrements supprimés sont filtrés. Pour les inclure :

```typescript
// Inclure les supprimés
await prisma.user.findMany({
  where: {
    // Pas de filtre deletedAt
  },
  includeDeleted: true, // Option personnalisée
});
```

### Restauration

```typescript
await prisma.user.update({
  where: { id: userId },
  data: { deletedAt: null, deletedBy: null },
});
```

### Suppression définitive

```typescript
// Forcer la suppression réelle
await prisma.user.delete({
  where: { id: userId },
  force: true, // Option personnalisée
});
```

## Migration

Pour ajouter les soft deletes à un modèle existant :

1. Créer une migration pour ajouter `deletedAt` et `deletedBy`
2. Mettre à jour le schéma Prisma
3. Ajouter le middleware
4. Migrer les données existantes si nécessaire

## Recommandations

### Quand utiliser les soft deletes :

- ✅ Données critiques (utilisateurs, compétitions)
- ✅ Données nécessitant un audit
- ✅ Données pouvant être restaurées

### Quand NE PAS utiliser les soft deletes :

- ❌ Données temporaires (tokens, cache)
- ❌ Données volumineuses sans valeur historique
- ❌ Données sensibles nécessitant une suppression définitive (RGPD)

## Exemple : Registration avec soft delete

Actuellement, les inscriptions sont supprimées définitivement lors de `unregister`. Avec les soft deletes :

```typescript
// Avant
await prisma.registration.delete({ where: { id } });

// Après
await prisma.registration.update({
  where: { id },
  data: {
    deletedAt: new Date(),
    deletedBy: userId,
    status: RegistrationStatus.CANCELLED, // Changer le statut aussi
  },
});
```

Cela permet de :

- Conserver l'historique des inscriptions annulées
- Générer des statistiques sur les annulations
- Permettre la restauration si nécessaire

## Conclusion

Les soft deletes sont un outil puissant mais doivent être utilisés avec discernement. Évaluez les besoins métier avant d'implémenter pour chaque modèle.
