import {
  emailSchema,
  passwordSchema,
  loginSchema,
  registerSchema,
  competitionSchema,
  eventSchema,
  validate,
  validateSafe,
  formatZodError,
} from "../validation";

describe("validation utils", () => {
  describe("emailSchema", () => {
    it("validates valid emails", () => {
      expect(emailSchema.safeParse("test@example.com").success).toBe(true);
      expect(emailSchema.safeParse("user.name@domain.co.uk").success).toBe(
        true,
      );
    });

    it("identifies invalid emails", () => {
      expect(emailSchema.safeParse("invalid-email").success).toBe(false);
      expect(emailSchema.safeParse("test@").success).toBe(false);
    });
  });

  describe("passwordSchema", () => {
    it("validates robust passwords", () => {
      // min 8, 1+ uppercase, 1+ lowercase, 1+ digit
      expect(passwordSchema.safeParse("Abcdefg1").success).toBe(true);
    });

    it("identifies weak passwords", () => {
      expect(passwordSchema.safeParse("1234567").success).toBe(false); // too short
      expect(passwordSchema.safeParse("abcdefgh").success).toBe(false); // no uppercase/digit
      expect(passwordSchema.safeParse("ABCDEFGH1").success).toBe(false); // no lowercase
      expect(passwordSchema.safeParse("Abcdefgh").success).toBe(false); // no digit
    });
  });

  describe("loginSchema", () => {
    it("validates valid login data", () => {
      const result = loginSchema.safeParse({
        email: "test@example.com",
        password: "password123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty password", () => {
      const result = loginSchema.safeParse({
        email: "test@example.com",
        password: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = loginSchema.safeParse({
        email: "invalid",
        password: "password",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("registerSchema", () => {
    it("validates valid registration data", () => {
      const result = registerSchema.safeParse({
        email: "user@test.com",
        password: "SecureP4ss",
        firstName: "Jean",
        lastName: "Dupont",
      });
      expect(result.success).toBe(true);
    });

    it("accepts optional birthDate and clubName", () => {
      const result = registerSchema.safeParse({
        email: "user@test.com",
        password: "SecureP4ss",
        firstName: "Jean",
        lastName: "Dupont",
        birthDate: "1990-01-01",
        clubName: "Club Test",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing firstName", () => {
      const result = registerSchema.safeParse({
        email: "user@test.com",
        password: "SecureP4ss",
        firstName: "",
        lastName: "Dupont",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("competitionSchema", () => {
    it("validates valid competition data", () => {
      const result = competitionSchema.safeParse({
        title: "Compétition Test",
        date: "2025-06-15T10:00:00.000Z",
        location: "Paris",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid datetime", () => {
      const result = competitionSchema.safeParse({
        title: "Compétition",
        date: "invalid-date",
        location: "Paris",
      });
      expect(result.success).toBe(false);
    });

    it("accepts optional fields", () => {
      const result = competitionSchema.safeParse({
        title: "Comp",
        date: "2025-06-15T10:00:00.000Z",
        location: "Paris",
        address: "1 rue Test",
        city: "Lyon",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("eventSchema", () => {
    it("validates valid event data", () => {
      const result = eventSchema.safeParse({
        competitionId: "550e8400-e29b-41d4-a716-446655440000",
        category: "Standard",
        ageGroup: "Adult",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid uuid", () => {
      const result = eventSchema.safeParse({
        competitionId: "not-a-uuid",
        category: "Standard",
        ageGroup: "Adult",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("validate", () => {
    it("returns parsed data for valid input", () => {
      const result = validate(emailSchema, "test@example.com");
      expect(result).toBe("test@example.com");
    });

    it("throws ZodError for invalid input", () => {
      expect(() => validate(emailSchema, "invalid")).toThrow();
    });
  });

  describe("validateSafe", () => {
    it("returns success for valid data", () => {
      const result = validateSafe(emailSchema, "test@example.com");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("test@example.com");
      }
    });

    it("returns error for invalid data", () => {
      const result = validateSafe(emailSchema, "not-an-email");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toBeDefined();
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe("formatZodError", () => {
    it("formats single error with path", () => {
      const result = validateSafe(loginSchema, {
        email: "invalid",
        password: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
      }
    });

    it("formats multiple errors", () => {
      const result = validateSafe(registerSchema, {
        email: "bad",
        password: "short",
        firstName: "",
        lastName: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(msg).toContain("\n");
      }
    });

    it("formats error without path (root level)", () => {
      const result = validateSafe(emailSchema, 123);
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
      }
    });
  });
});
