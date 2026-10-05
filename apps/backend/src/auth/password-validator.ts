/**
 * Service de validation de mot de passe avec politique de sécurité robuste
 */

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Politique de mot de passe :
 * - Minimum 8 caractères
 * - Au moins une majuscule
 * - Au moins une minuscule
 * - Au moins un chiffre
 * - Au moins un caractère spécial (!@#$%^&*()_+-=[]{}|;:,.<>?)
 */
export class PasswordValidator {
  private static readonly MIN_LENGTH = 8;
  private static readonly HAS_UPPERCASE = /[A-Z]/;
  private static readonly HAS_LOWERCASE = /[a-z]/;
  private static readonly HAS_DIGIT = /[0-9]/;
  private static readonly HAS_SPECIAL_CHAR = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/;

  /**
   * Valide un mot de passe selon la politique de sécurité
   *
   * @param password - Le mot de passe à valider
   * @returns Résultat de validation avec liste d'erreurs
   */
  static validate(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (!password || password.length < this.MIN_LENGTH) {
      errors.push(
        `Le mot de passe doit contenir au moins ${this.MIN_LENGTH} caractères`,
      );
    }

    if (!this.HAS_UPPERCASE.test(password)) {
      errors.push("Le mot de passe doit contenir au moins une majuscule");
    }

    if (!this.HAS_LOWERCASE.test(password)) {
      errors.push("Le mot de passe doit contenir au moins une minuscule");
    }

    if (!this.HAS_DIGIT.test(password)) {
      errors.push("Le mot de passe doit contenir au moins un chiffre");
    }

    if (!this.HAS_SPECIAL_CHAR.test(password)) {
      errors.push(
        "Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&*()_+-=[]{}|;:,.<>?)",
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Vérifie si un mot de passe respecte la longueur minimale
   */
  static hasMinLength(password: string): boolean {
    return password.length >= this.MIN_LENGTH;
  }

  /**
   * Retourne la description de la politique de mot de passe
   */
  static getPolicyDescription(): string {
    return `Le mot de passe doit contenir :
- Au moins ${this.MIN_LENGTH} caractères
- Au moins une majuscule
- Au moins une minuscule
- Au moins un chiffre
- Au moins un caractère spécial (!@#$%^&*()_+-=[]{}|;:,.<>?)`;
  }
}
