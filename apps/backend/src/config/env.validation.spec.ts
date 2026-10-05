import "reflect-metadata";
import { validate } from "./env.validation";

const VALID_BASE = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  JWT_SECRET: "a-very-long-secret-that-is-at-least-32-chars-long",
};

describe("validate (env.validation)", () => {
  describe("champs requis", () => {
    it("accepte une config minimale valide", () => {
      expect(() => validate(VALID_BASE)).not.toThrow();
    });

    it("lève une erreur si DATABASE_URL est absent", () => {
      const { DATABASE_URL: _, ...config } = VALID_BASE;
      expect(() => validate(config)).toThrow(
        "Erreur de validation des variables d'environnement",
      );
    });

    it("lève une erreur si JWT_SECRET est absent", () => {
      const { JWT_SECRET: _, ...config } = VALID_BASE;
      expect(() => validate(config)).toThrow(
        "Erreur de validation des variables d'environnement",
      );
    });

    it("lève une erreur si JWT_SECRET est trop court (< 32 caractères)", () => {
      expect(() =>
        validate({ ...VALID_BASE, JWT_SECRET: "trop-court" }),
      ).toThrow("JWT_SECRET must be at least 32 characters long for security");
    });
  });

  describe("NODE_ENV", () => {
    it("accepte 'development'", () => {
      const result = validate({ ...VALID_BASE, NODE_ENV: "development" });
      expect(result.NODE_ENV).toBe("development");
    });

    it("accepte 'production'", () => {
      const result = validate({ ...VALID_BASE, NODE_ENV: "production" });
      expect(result.NODE_ENV).toBe("production");
    });

    it("accepte 'test'", () => {
      const result = validate({ ...VALID_BASE, NODE_ENV: "test" });
      expect(result.NODE_ENV).toBe("test");
    });

    it("lève une erreur pour une valeur invalide", () => {
      expect(() => validate({ ...VALID_BASE, NODE_ENV: "staging" })).toThrow(
        "Erreur de validation des variables d'environnement",
      );
    });

    it("utilise 'development' par défaut si absent", () => {
      const result = validate(VALID_BASE);
      expect(result.NODE_ENV).toBe("development");
    });
  });

  describe("PORT", () => {
    it("accepte un port valide", () => {
      const result = validate({ ...VALID_BASE, PORT: 4000 });
      expect(result.PORT).toBe(4000);
    });

    it("utilise 3000 par défaut si absent", () => {
      const result = validate(VALID_BASE);
      expect(result.PORT).toBe(3000);
    });

    it("lève une erreur pour un port trop bas (< 1)", () => {
      expect(() => validate({ ...VALID_BASE, PORT: 0 })).toThrow(
        "Erreur de validation des variables d'environnement",
      );
    });

    it("lève une erreur pour un port trop haut (> 65535)", () => {
      expect(() => validate({ ...VALID_BASE, PORT: 70000 })).toThrow(
        "Erreur de validation des variables d'environnement",
      );
    });

    it("coerce les chaînes en nombre via enableImplicitConversion", () => {
      const result = validate({ ...VALID_BASE, PORT: "8080" });
      expect(result.PORT).toBe(8080);
    });
  });

  describe("champs optionnels avec valeurs par défaut", () => {
    it("utilise 'localhost' pour REDIS_HOST par défaut", () => {
      const result = validate(VALID_BASE);
      expect(result.REDIS_HOST).toBe("localhost");
    });

    it("utilise 6379 pour REDIS_PORT par défaut", () => {
      const result = validate(VALID_BASE);
      expect(result.REDIS_PORT).toBe(6379);
    });

    it("utilise 100 pour FFD_ITEMS_PER_PAGE par défaut", () => {
      const result = validate(VALID_BASE);
      expect(result.FFD_ITEMS_PER_PAGE).toBe(100);
    });
  });

  describe("champs optionnels sans valeur par défaut", () => {
    it("accepte CORS_ORIGINS défini", () => {
      const result = validate({
        ...VALID_BASE,
        CORS_ORIGINS: "http://localhost:3000",
      });
      expect(result.CORS_ORIGINS).toBe("http://localhost:3000");
    });

    it("accepte les credentials Firebase optionnels", () => {
      const result = validate({
        ...VALID_BASE,
        FIREBASE_PROJECT_ID: "my-project",
        FIREBASE_CLIENT_EMAIL: "sa@my-project.iam.gserviceaccount.com",
        FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\n...",
      });
      expect(result.FIREBASE_PROJECT_ID).toBe("my-project");
    });

    it("accepte les credentials WDSF optionnels", () => {
      const result = validate({
        ...VALID_BASE,
        WDSF_API_KEY: "key",
        WDSF_USERNAME: "user",
        WDSF_PASSWORD: "pass",
      });
      expect(result.WDSF_API_KEY).toBe("key");
    });

    it("accepte SENTRY_DSN optionnel", () => {
      const result = validate({
        ...VALID_BASE,
        SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
      });
      expect(result.SENTRY_DSN).toBe(
        "https://examplePublicKey@o0.ingest.sentry.io/0",
      );
    });

    it("accepte HELLOASSO_WEBHOOK_SECRET optionnel", () => {
      const result = validate({
        ...VALID_BASE,
        HELLOASSO_WEBHOOK_SECRET: "whsec_123",
      });
      expect(result.HELLOASSO_WEBHOOK_SECRET).toBe("whsec_123");
    });

    it("accepte APP_URL optionnel", () => {
      const result = validate({
        ...VALID_BASE,
        APP_URL: "https://app.ffd-connect.fr",
      });
      expect(result.APP_URL).toBe("https://app.ffd-connect.fr");
    });

    it("accepte GOOGLE_APPLICATION_CREDENTIALS optionnel", () => {
      const result = validate({
        ...VALID_BASE,
        GOOGLE_APPLICATION_CREDENTIALS: "/path/to/creds.json",
      });
      expect(result.GOOGLE_APPLICATION_CREDENTIALS).toBe("/path/to/creds.json");
    });

    it("accepte FIREBASE_SERVICE_ACCOUNT_PATH optionnel", () => {
      const result = validate({
        ...VALID_BASE,
        FIREBASE_SERVICE_ACCOUNT_PATH: "/path/to/firebase-sa.json",
      });
      expect(result.FIREBASE_SERVICE_ACCOUNT_PATH).toBe(
        "/path/to/firebase-sa.json",
      );
    });

    it("accepte FIREBASE_SERVICE_ACCOUNT_JSON optionnel", () => {
      const serviceAccount = JSON.stringify({
        project_id: "ffd-connect",
        client_email: "sa@ffd-connect.iam.gserviceaccount.com",
        private_key:
          "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n",
      });
      const result = validate({
        ...VALID_BASE,
        FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount,
      });
      expect(result.FIREBASE_SERVICE_ACCOUNT_JSON).toBe(serviceAccount);
    });

    it("accepte ENABLE_IP_BLACKLIST optionnel", () => {
      const result = validate({
        ...VALID_BASE,
        ENABLE_IP_BLACKLIST: "true",
      });
      expect(result.ENABLE_IP_BLACKLIST).toBe("true");
    });
  });

  describe("retourne une instance typée", () => {
    it("retourne tous les champs attendus sur un config complet", () => {
      const result = validate({
        ...VALID_BASE,
        NODE_ENV: "production",
        PORT: 8080,
        REDIS_HOST: "redis-host",
        REDIS_PORT: 6380,
        CORS_ORIGINS: "https://app.example.com",
        GITHUB_TOKEN: "ghp_xxx",
        GITHUB_OWNER: "my-org",
        GITHUB_REPO: "my-repo",
        FRONTEND_URL: "https://app.example.com",
      });

      expect(result).toMatchObject({
        NODE_ENV: "production",
        PORT: 8080,
        DATABASE_URL: VALID_BASE.DATABASE_URL,
        JWT_SECRET: VALID_BASE.JWT_SECRET,
        REDIS_HOST: "redis-host",
        REDIS_PORT: 6380,
        CORS_ORIGINS: "https://app.example.com",
        GITHUB_TOKEN: "ghp_xxx",
      });
    });
  });
});
