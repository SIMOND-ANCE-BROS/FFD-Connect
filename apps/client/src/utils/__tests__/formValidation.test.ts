import { z } from "zod";
import { validateField, validateForm } from "../formValidation";

const loginSchema = z.object({
  username: z.string().min(1, "L'identifiant est requis"),
  password: z
    .string()
    .min(6, "Le mot de passe doit faire au moins 6 caractères"),
});

describe("formValidation", () => {
  describe("validateForm", () => {
    it("returns success with data when valid", () => {
      const result = validateForm(loginSchema, {
        username: "user@test.com",
        password: "secret123",
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        username: "user@test.com",
        password: "secret123",
      });
      expect(result.errors).toBeUndefined();
    });

    it("returns errors when invalid", () => {
      const result = validateForm(loginSchema, {
        username: "",
        password: "123",
      });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.username).toContain("identifiant");
      expect(result.errors?.password).toBeDefined();
    });

    it("handles nested path in errors", () => {
      const schema = z.object({
        user: z.object({
          name: z.string().min(1),
        }),
      });
      const result = validateForm(schema, { user: { name: "" } });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(Object.keys(result.errors ?? {})).toContain("user.name");
    });
  });

  describe("validateField", () => {
    it("returns null when valid", () => {
      const result = validateField(
        z.string().email(),
        "email",
        "valid@test.com",
      );
      expect(result).toBeNull();
    });

    it("returns error message when field invalid and path matches", () => {
      const schema = z.object({ email: z.string().email("Invalid email") });
      const result = validateField(schema, "email", { email: "invalid" });
      expect(result).toBeTruthy();
    });

    it("returns null when value is valid", () => {
      const schema = z.object({ email: z.string().email() });
      const result = validateField(schema, "email", {
        email: "valid@test.com",
      });
      expect(result).toBeNull();
    });

    it("returns generic error message when validation throws non-ZodError", () => {
      const schema = z.any().transform(() => {
        throw new Error("Custom runtime error");
      });
      const result = validateField(schema, "x", "value");
      expect(result).toBe("Erreur de validation");
    });
  });
});
