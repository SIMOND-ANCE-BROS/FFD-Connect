---
trigger: always_on
---

# 📐 Règle Système 2 : Data & Architecture Hexagonale

## 🌐 Pattern Repository & Injection

Les composants et hooks logiques ne connaissent que les **Interfaces**, jamais les implémentations.

### Workflow d'Implémentation Imposé

**1. Interface (Contract)**

````typescript
export interface AuthRepository {
  login(email: string, pass: string): Promise<User>;
}

2. Implémentation Concrète (Service) C'est le seul endroit où fetch ou axios sont autorisés.

3. Injection via Context (Boilerplate)
TypeScript

// AuthContext.tsx
interface AuthProviderProps {
  children: ReactNode;
  implementation: AuthRepository; // 👈 Injection ici
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children, implementation }) => (
  <AuthContext.Provider value={implementation}>{children}</AuthContext.Provider>
);

// Service Hook (Point d'accès unique)
export const useAuthRepository = (): AuthRepository => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthRepository must be used within AuthProvider');
  return context;
};

❌ Interdictions Formelles

    Jamais d'import direct (new AuthService()) dans un hook logique.

    Jamais de fetch dans un composant UI.

🚨 Gestion d'Erreurs Avancée

Si besoin, générer la classe ApiError :
TypeScript

export class ApiError extends Error {
  constructor(public statusCode: number, public message: string) { super(message); }
}

Dans le Hook Logique :
TypeScript

try {
  await repo.action();
} catch (err) {
  if (err instanceof ApiError && err.statusCode === 401) { ... }
  setError(err instanceof Error ? err.message : 'Erreur');
} finally {
  setLoading(false);
}


---

### 📁 Fichier 4 : `03_QA_Testing_Rules.md`
**Usage :** Génération de tests et QA.

```markdown
# 📐 Règle Système 3 : Stratégie de Test & QA

## 🏷️ Test IDs (Obligatoire)
Tout élément interactif doit avoir un `testID`.
* **Convention :** `kebab-case` → `[page]-[composant]-[action]`
* **Exemples :** `login-email-input`, `profile-save-button`.

## 🧪 Stratégie de Test

### 1. Tests Unitaires (Hooks)
* **Cible :** `useFeatureLogic.ts`
* **Outil :** `renderHook` (`@testing-library/react-native`).
* **Règle d'or :** Mocker le **Service Hook**, jamais `fetch` directement.

```typescript
// ✅ Mock correct du module Service Hook
import * as AuthHooks from '@/Services/Auth/AuthContext';
jest.mock('@/Services/Auth/AuthContext', () => ({
  useAuthRepository: jest.fn()
}));

// Dans le test
(AuthHooks.useAuthRepository as jest.Mock).mockReturnValue({
  login: jest.fn().mockResolvedValue(...)
});

2. Tests d'Intégration (Composants UI)

    Cible : FeatureScreen.tsx

    Outil : render, fireEvent.

    Méthode : Utiliser getByTestId pour interagir avec l'UI.

    Scope : Vérifier que l'UI réagit aux états mockés (Loading spinner, Message d'erreur, Navigation).
````
