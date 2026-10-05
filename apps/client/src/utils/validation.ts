/**
 * Utilitaires de validation avec Zod
 * Schémas de validation réutilisables pour l'application mobile
 */

import { z } from "zod";

/**
 * Schéma de validation pour l'email
 */
export const emailSchema = z.string().email("Email invalide");

/**
 * Schéma de validation pour le mot de passe
 */
export const passwordSchema = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caractères")
  .regex(/[A-Z]/, "Le mot de passe doit contenir au moins une majuscule")
  .regex(/[a-z]/, "Le mot de passe doit contenir au moins une minuscule")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre");

/**
 * Schéma de validation pour la connexion
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Le mot de passe est requis"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Schéma de validation pour l'inscription
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1, "Le prénom est requis"),
  lastName: z.string().min(1, "Le nom est requis"),
  birthDate: z.string().optional(),
  clubName: z.string().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Schéma de validation pour la création d'une compétition
 */
export const competitionSchema = z.object({
  title: z.string().min(1, "Le titre est requis"),
  date: z.string().datetime("Date invalide"),
  location: z.string().min(1, "La localisation est requise"),
  address: z.string().optional(),
  city: z.string().optional(),
  zipCode: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
});

export type CompetitionInput = z.infer<typeof competitionSchema>;

/**
 * Schéma de validation pour la création d'un événement
 */
export const eventSchema = z.object({
  competitionId: z.string().uuid("ID de compétition invalide"),
  category: z.string().min(1, "La catégorie est requise"),
  ageGroup: z.string().min(1, "Le groupe d'âge est requis"),
});

export type EventInput = z.infer<typeof eventSchema>;

/**
 * Fonction utilitaire pour valider des données avec Zod
 *
 * @param schema - Schéma Zod de validation
 * @param data - Données à valider
 * @returns Données validées ou lève une erreur
 *
 * @example
 * ```typescript
 * try {
 *   const validData = validate(loginSchema, { email: 'test@example.com', password: 'password' });
 * } catch (error) {
 *   // Gérer les erreurs de validation
 * }
 * ```
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Fonction utilitaire pour valider des données avec Zod (safe)
 * Retourne un résultat au lieu de lever une erreur
 *
 * @param schema - Schéma Zod de validation
 * @param data - Données à valider
 * @returns Résultat de validation avec succès ou erreurs
 *
 * @example
 * ```typescript
 * const result = validateSafe(loginSchema, { email: 'test@example.com', password: 'password' });
 * if (result.success) {
 *   // Utiliser result.data
 * } else {
 *   // Afficher result.error.issues
 * }
 * ```
 */
export function validateSafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return result;
  }
  return result;
}

/**
 * Formate les erreurs Zod en message lisible
 *
 * @param error - Erreur Zod
 * @returns Message d'erreur formaté
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((err) => {
      const path = err.path.join(".");
      return path ? `${path}: ${err.message}` : err.message;
    })
    .join("\n");
}
