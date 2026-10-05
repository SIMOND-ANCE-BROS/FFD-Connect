import { z } from "zod";

/**
 * Utilitaire pour valider un formulaire avec Zod
 *
 * @example
 * ```typescript
 * const result = validateForm(loginSchema, { username: '', password: '123' });
 * if (!result.success) {
 *   console.log(result.errors); // { username: 'L\'identifiant est requis', password: '...' }
 * }
 * ```
 */
export function validateForm<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): {
  success: boolean;
  data?: z.infer<T>;
  errors?: Record<string, string>;
} {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  // Transformer les erreurs Zod en objet simple
  const errors: Record<string, string> = {};
  result.error.issues.forEach((error) => {
    const path = error.path.join(".");
    errors[path] = error.message;
  });

  return {
    success: false,
    errors,
  };
}

/**
 * Valide un champ spécifique
 */
export function validateField<T extends z.ZodTypeAny>(
  schema: T,
  fieldName: string,
  value: unknown,
): string | null {
  try {
    schema.parse(value);
    return null;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldError = error.issues.find((e) => e.path.includes(fieldName));
      return fieldError?.message ?? null;
    }
    return "Erreur de validation";
  }
}
