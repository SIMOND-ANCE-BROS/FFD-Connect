---
trigger: always_on
---

# 📐 Règle Système 4 : Styling & Design System

## 🎨 Règles de Style
1.  **Pas de Inline Styles :** `style={{ width: 100 }}` est ❌ interdit (sauf pour les valeurs dynamiques d'animation type Reanimated).
2.  **Outil :** Utiliser `StyleSheet.create` ou `NativeWind` (selon la configuration du projet).
3.  **Organisation :**
    * **Composants simples :** Styles définis en bas du fichier composant.
    * **Écrans complexes :** Styles extraits dans un fichier `NomScreen.styles.ts`.

## 📝 Conventions de Nommage
* **CamelCase** pour les objets de style.
* **Noms sémantiques :**
    * Conteneurs : `container`, `wrapper`, `content`.
    * Texte : `title`, `subtitle`, `label`, `caption`.
    * États : `buttonDisabled`, `inputError`.

## 💡 Exemple
```typescript
// styles.ts
export const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  primaryButton: {
    marginTop: 20,
    borderRadius: 8,
  }
});