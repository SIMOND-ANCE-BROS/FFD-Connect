import { z } from "zod";

/**
 * Schéma de validation pour le formulaire de connexion
 */
export const loginSchema = z.object({
  username: z.string().trim().min(1, "L'identifiant est requis"),
  password: z
    .string()
    .min(6, "Le mot de passe doit contenir au moins 6 caractères")
    .max(100, "Le mot de passe est trop long"),
});

/**
 * Type inféré du schéma de connexion
 */
export type LoginFormData = z.infer<typeof loginSchema>;
