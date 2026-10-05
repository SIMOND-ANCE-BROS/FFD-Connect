import { PasswordValidator } from "./password-validator";

describe("PasswordValidator", () => {
  describe("validate", () => {
    it("should accept valid password", () => {
      const result = PasswordValidator.validate("ValidPass1!");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject password shorter than 8 chars", () => {
      const result = PasswordValidator.validate("Short1!");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Le mot de passe doit contenir au moins 8 caractères",
      );
    });

    it("should reject empty password", () => {
      const result = PasswordValidator.validate("");
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject password without uppercase", () => {
      const result = PasswordValidator.validate("validpass1!");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Le mot de passe doit contenir au moins une majuscule",
      );
    });

    it("should reject password without lowercase", () => {
      const result = PasswordValidator.validate("VALIDPASS1!");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Le mot de passe doit contenir au moins une minuscule",
      );
    });

    it("should reject password without digit", () => {
      const result = PasswordValidator.validate("ValidPass!");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Le mot de passe doit contenir au moins un chiffre",
      );
    });

    it("should reject password without special char", () => {
      const result = PasswordValidator.validate("ValidPass1");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&*()_+-=[]{}|;:,.<>?)",
      );
    });

    it("should accumulate multiple errors", () => {
      const result = PasswordValidator.validate("short");
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe("hasMinLength", () => {
    it("should return true for 8+ chars", () => {
      expect(PasswordValidator.hasMinLength("12345678")).toBe(true);
      expect(PasswordValidator.hasMinLength("123456789")).toBe(true);
    });

    it("should return false for less than 8 chars", () => {
      expect(PasswordValidator.hasMinLength("1234567")).toBe(false);
      expect(PasswordValidator.hasMinLength("")).toBe(false);
    });
  });

  describe("getPolicyDescription", () => {
    it("should return policy description string", () => {
      const desc = PasswordValidator.getPolicyDescription();
      expect(desc).toContain("8 caractères");
      expect(desc).toContain("majuscule");
      expect(desc).toContain("minuscule");
      expect(desc).toContain("chiffre");
      expect(desc).toContain("caractère spécial");
    });
  });
});
