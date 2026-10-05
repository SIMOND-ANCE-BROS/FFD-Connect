import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { cert, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type Message } from "firebase-admin/messaging";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "./notifications.service";

jest.mock("firebase-admin/app", () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
}));
jest.mock("firebase-admin/messaging", () => ({
  getMessaging: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue("mock-response"),
  }),
}));

/** Erreur telle que la lève firebase-admin : un Error porteur d'un `code`. */
const fcmError = (code: string): Error =>
  Object.assign(new Error(`FCM error ${code}`), { code });

describe("NotificationsService", () => {
  let service: NotificationsService;

  const mockPrisma = {
    notification: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    deviceToken: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  };

  /** Valeurs d'environnement lues par le service, réinitialisées à chaque test. */
  let configValues: Record<string, string | undefined> = {};
  const mockConfig = {
    get: jest.fn((key: string) => configValues[key]),
  };

  /**
   * Circuit breaker : par défaut transparent (exécute l'appel). Les tests de
   * dégradation le font rejeter comme opossum le fait circuit ouvert.
   */
  const mockCircuitBreaker = {
    fire: jest.fn(),
  };

  const sendMock = () => getMessaging().send as jest.Mock;

  /** Simule un Firebase initialisé (mode envoi réel). */
  const withFirebaseApp = () => {
    (service as unknown as { firebaseApp: App | null }).firebaseApp = {
      name: "mock",
    } as App;
  };

  /** `true` quand le service est resté (ou a basculé) en mode mock. */
  const isMockMode = () =>
    !(service as unknown as { firebaseApp?: App }).firebaseApp;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();

    configValues = {};
    mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.deviceToken.findMany.mockResolvedValue([]);
    mockPrisma.deviceToken.updateMany.mockResolvedValue({ count: 1 });
    mockCircuitBreaker.fire.mockImplementation(
      (_key: string, fn: () => Promise<unknown>) => fn(),
    );
    sendMock().mockReset();
    sendMock().mockResolvedValue("mock-response");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe("onModuleInit", () => {
    /** private_key avec des `\n` doublement échappés, comme injecté par variable d'env. */
    const SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "ffd-connect",
      client_email: "push@ffd-connect.iam.gserviceaccount.com",
      private_key: "-----BEGIN KEY-----\\nabc\\n-----END KEY-----\\n",
    });

    beforeEach(() => {
      (initializeApp as jest.Mock).mockReset();
      (initializeApp as jest.Mock).mockReturnValue({ name: "app" });
      (cert as jest.Mock).mockReset();
      (cert as jest.Mock).mockReturnValue({ credential: "mock-credential" });
    });

    it("initialise Firebase depuis FIREBASE_SERVICE_ACCOUNT_JSON (Key Vault)", () => {
      configValues.FIREBASE_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT_JSON;

      service.onModuleInit();

      expect(cert).toHaveBeenCalledWith({
        projectId: "ffd-connect",
        clientEmail: "push@ffd-connect.iam.gserviceaccount.com",
        // les `\n` échappés sont restaurés en vrais retours à la ligne
        privateKey: "-----BEGIN KEY-----\nabc\n-----END KEY-----\n",
      });
      expect(initializeApp).toHaveBeenCalledWith({
        credential: { credential: "mock-credential" },
      });
    });

    it("privilégie le JSON sur le chemin de fichier quand les deux sont fournis", () => {
      configValues.FIREBASE_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT_JSON;
      configValues.FIREBASE_SERVICE_ACCOUNT_PATH = "/path/to/cert.json";

      service.onModuleInit();

      expect(cert).toHaveBeenCalledTimes(1);
      expect(cert).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "ffd-connect" }),
      );
    });

    it("retombe sur FIREBASE_SERVICE_ACCOUNT_PATH (dev local)", () => {
      configValues.FIREBASE_SERVICE_ACCOUNT_PATH = "/path/to/cert.json";

      service.onModuleInit();

      expect(cert).toHaveBeenCalledWith("/path/to/cert.json");
      expect(initializeApp).toHaveBeenCalled();
    });

    it("retombe sur le chemin quand le JSON est illisible", () => {
      configValues.FIREBASE_SERVICE_ACCOUNT_JSON = "not-json";
      configValues.FIREBASE_SERVICE_ACCOUNT_PATH = "/path/to/cert.json";

      service.onModuleInit();

      expect(cert).toHaveBeenCalledWith("/path/to/cert.json");
      expect(initializeApp).toHaveBeenCalled();
    });

    it("retombe sur le chemin quand le JSON est incomplet (private_key manquante)", () => {
      configValues.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
        project_id: "ffd-connect",
        client_email: "push@ffd-connect.iam.gserviceaccount.com",
      });
      configValues.FIREBASE_SERVICE_ACCOUNT_PATH = "/path/to/cert.json";

      service.onModuleInit();

      expect(cert).toHaveBeenCalledWith("/path/to/cert.json");
    });

    it("reste en mode mock quand le JSON est un scalaire", () => {
      configValues.FIREBASE_SERVICE_ACCOUNT_JSON = '"just-a-string"';

      service.onModuleInit();

      expect(cert).not.toHaveBeenCalled();
      expect(initializeApp).not.toHaveBeenCalled();
    });

    it("reste en mode mock (sans crash) quand aucun credential n'est fourni", () => {
      service.onModuleInit();

      expect(initializeApp).not.toHaveBeenCalled();
    });

    it("n'échoue pas quand l'initialisation Firebase lève", () => {
      configValues.FIREBASE_SERVICE_ACCOUNT_PATH = "/path/to/cert.json";
      (initializeApp as jest.Mock).mockImplementation(() => {
        throw new Error("init fail");
      });

      expect(() => service.onModuleInit()).not.toThrow();
      expect(isMockMode()).toBe(true);
    });

    // `cert()` est synchrone et lève sur un PEM malformé ou un fichier de clé
    // illisible ; `parseServiceAccount` ne valide que la présence de trois
    // chaînes non vides, jamais le format de la clé. Si l'exception remontait,
    // l'init du module NestJS échouerait et le conteneur ne démarrerait pas —
    // sur une rotation de secret sans redéploiement, aucune révision à
    // rollbacker et crash-loop à chaque réveil (minReplicas=0).

    it("bascule en mode mock quand cert() lève sur le JSON (clé privée malformée)", () => {
      configValues.FIREBASE_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT_JSON;
      (cert as jest.Mock).mockImplementation(() => {
        throw new Error("Failed to parse private key.");
      });

      expect(() => service.onModuleInit()).not.toThrow();

      expect(cert).toHaveBeenCalledTimes(1);
      expect(initializeApp).not.toHaveBeenCalled();
      expect(isMockMode()).toBe(true);
    });

    it("bascule en mode mock quand cert() lève sur le chemin de fichier (fichier absent)", () => {
      configValues.FIREBASE_SERVICE_ACCOUNT_PATH = "/path/to/missing.json";
      (cert as jest.Mock).mockImplementation(() => {
        throw new Error("Failed to parse private key.");
      });

      expect(() => service.onModuleInit()).not.toThrow();

      expect(cert).toHaveBeenCalledWith("/path/to/missing.json");
      expect(initializeApp).not.toHaveBeenCalled();
      expect(isMockMode()).toBe(true);
    });

    it("ne journalise jamais le contenu du JSON illisible (fuite de clé privée)", () => {
      // JSON tronqué en plein milieu de la clé : le message d'un JSON.parse V8
      // recopie une fenêtre du texte source autour du point de rupture, qui
      // atterrirait dans Azure Log Analytics (droits plus larges que Key Vault).
      const truncated =
        '{"project_id":"ffd","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg';
      configValues.FIREBASE_SERVICE_ACCOUNT_JSON = truncated;
      const errorSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      service.onModuleInit();

      const logged = errorSpy.mock.calls.flat().join(" ");
      expect(logged).toContain("not valid JSON");
      expect(logged).toContain(String(truncated.length));
      expect(logged).not.toContain("BEGIN PRIVATE KEY");
      expect(logged).not.toContain("MIIEvQIBADANBg");
    });
  });

  describe("sendToDevice", () => {
    it("should create notification in DB and send via Firebase", async () => {
      withFirebaseApp();
      await service.sendToDevice(
        "token",
        "Title",
        "Body",
        { key: "val" },
        "user1",
      );

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: "user1",
          title: "Title",
          body: "Body",
          data: { key: "val" },
        },
      });
      expect(sendMock()).toHaveBeenCalledWith({
        notification: { title: "Title", body: "Body" },
        token: "token",
        data: { key: "val" },
      });
    });

    it("should handle mock mode (no firebaseApp)", async () => {
      (service as unknown as { firebaseApp: App | null }).firebaseApp = null;
      await service.sendToDevice("token", "Title", "Body");

      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(sendMock()).not.toHaveBeenCalled();
    });

    it("mode mock : ne journalise jamais le token de l'appareil", async () => {
      // Le mode mock est actif dès que les credentials manquent, staging et
      // production incluses : le token est un identifiant d'appareil, donc une
      // donnée personnelle, et n'a rien à faire dans les logs.
      (service as unknown as { firebaseApp: App | null }).firebaseApp = null;
      const logSpy = jest
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => undefined);

      await service.sendToDevice("fcm-token-to-keep-secret", "Title", "Body");

      const logged = logSpy.mock.calls.flat().join(" ");
      expect(logged).toContain("[MOCK]");
      expect(logged).not.toContain("fcm-token-to-keep-secret");
    });

    it("passe l'envoi FCM par le circuit breaker « fcm »", async () => {
      withFirebaseApp();

      await service.sendToDevice("token", "Title", "Body");

      expect(mockCircuitBreaker.fire).toHaveBeenCalledWith(
        "fcm",
        expect.any(Function),
      );
    });

    it("should handle firebase send errors", async () => {
      withFirebaseApp();
      sendMock().mockRejectedValue(new Error("fail"));

      // Should not throw
      await expect(
        service.sendToDevice("token", "Title", "Body"),
      ).resolves.toBeUndefined();
      expect(mockPrisma.deviceToken.deleteMany).not.toHaveBeenCalled();
    });

    it("supprime le token quand FCM le déclare non enregistré", async () => {
      withFirebaseApp();
      sendMock().mockRejectedValue(
        fcmError("messaging/registration-token-not-registered"),
      );
      mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.sendToDevice("dead-token", "Title", "Body");

      expect(mockPrisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ["dead-token"] } },
      });
    });
  });

  describe("sendToTopic", () => {
    it("should send notification to topic", async () => {
      withFirebaseApp();
      await service.sendToTopic("topic1", "Title", "Body");

      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(sendMock()).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "topic1" }),
      );
    });
  });

  describe("getAllForUser", () => {
    it("should return combined user and global notifications", async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.getAllForUser("user1");
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ userId: "user1" }, { userId: null }],
          },
        }),
      );
    });
  });

  describe("createForUser", () => {
    it("crée une notification en base pour un utilisateur", async () => {
      await service.createForUser("u1", "Titre", "Corps", { k: "v" });
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: { userId: "u1", title: "Titre", body: "Corps", data: { k: "v" } },
      });
    });

    it("data par défaut = {} quand non fourni", async () => {
      await service.createForUser("u1", "Titre", "Corps");
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: { userId: "u1", title: "Titre", body: "Corps", data: {} },
      });
    });
  });

  describe("createManyForUsers", () => {
    it("no-op (count 0) sur une liste vide, sans requête", async () => {
      const res = await service.createManyForUsers([], "T", "B");
      expect(res).toEqual({ count: 0 });
      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });

    it("crée une notification par utilisateur en une requête (createMany)", async () => {
      mockPrisma.notification.createMany.mockResolvedValue({ count: 2 });
      const res = await service.createManyForUsers(["u1", "u2"], "T", "B", {
        k: "v",
      });
      expect(mockPrisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          { userId: "u1", title: "T", body: "B", data: { k: "v" } },
          { userId: "u2", title: "T", body: "B", data: { k: "v" } },
        ],
      });
      expect(res).toEqual({ count: 2 });
    });
  });

  describe("markAsRead", () => {
    it("should update specific notification for user", async () => {
      await service.markAsRead("n1", "u1");
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: "n1", userId: "u1" },
        data: { isRead: true },
      });
    });
  });

  describe("markAllAsRead", () => {
    it("should update all unread notifications for user", async () => {
      await service.markAllAsRead("u1");
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", isRead: false },
        data: { isRead: true },
      });
    });
  });

  // ─── Tokens d'appareil ─────────────────────────────────────────────────────

  describe("registerDeviceToken", () => {
    it("upsert sur le token : crée la ligne d'un appareil inconnu", async () => {
      await service.registerDeviceToken("u1", "fcm-token", "IOS");

      expect(mockPrisma.deviceToken.upsert).toHaveBeenCalledTimes(1);
      const [args] = mockPrisma.deviceToken.upsert.mock.calls[0] as [
        {
          where: { token: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        },
      ];
      expect(args.where).toEqual({ token: "fcm-token" });
      expect(args.create).toEqual({
        userId: "u1",
        token: "fcm-token",
        platform: "IOS",
      });
    });

    it("ré-attribue à l'utilisateur courant un token lié à un autre compte", async () => {
      await service.registerDeviceToken("new-owner", "shared-token", "ANDROID");

      const [args] = mockPrisma.deviceToken.upsert.mock.calls[0] as [
        { update: { userId: string; platform: string; lastSeenAt: Date } },
      ];
      // La branche `update` de l'upsert réécrit le propriétaire : sans ça, les
      // notifications de l'ancien compte continueraient d'arriver sur l'appareil.
      expect(args.update.userId).toBe("new-owner");
      expect(args.update.platform).toBe("ANDROID");
      expect(args.update.lastSeenAt).toBeInstanceOf(Date);
    });

    // ── Course sur la contrainte unique (P2002) ──────────────────────────────

    it("retente en update quand l'upsert perd la course P2002", async () => {
      // L'ouverture de session lance l'enregistrement pendant que FCM déclenche
      // `onTokenRefresh` avec le même token : l'upsert Prisma n'est pas atomique
      // sur un champ unique qui n'est pas l'`@id`, les deux `create` se croisent.
      mockPrisma.deviceToken.upsert.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

      await expect(
        service.registerDeviceToken("u1", "racing-token", "IOS"),
      ).resolves.toBeUndefined();

      expect(mockPrisma.deviceToken.updateMany).toHaveBeenCalledTimes(1);
      const [args] = mockPrisma.deviceToken.updateMany.mock.calls[0] as [
        {
          where: { token: string };
          data: { userId: string; platform: string; lastSeenAt: Date };
        },
      ];
      expect(args.where).toEqual({ token: "racing-token" });
      expect(args.data.userId).toBe("u1");
      expect(args.data.platform).toBe("IOS");
      expect(args.data.lastSeenAt).toBeInstanceOf(Date);
    });

    it("reste idempotent quand la ligne a disparu entre-temps (updateMany, 0 ligne)", async () => {
      mockPrisma.deviceToken.upsert.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
      mockPrisma.deviceToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.registerDeviceToken("u1", "vanished-token", "IOS"),
      ).resolves.toBeUndefined();
    });

    it("propage une erreur Prisma qui n'est pas un P2002", async () => {
      mockPrisma.deviceToken.upsert.mockRejectedValueOnce(
        Object.assign(new Error("Can't reach database server"), {
          code: "P1001",
        }),
      );

      await expect(
        service.registerDeviceToken("u1", "t", "IOS"),
      ).rejects.toThrow("Can't reach database server");
      expect(mockPrisma.deviceToken.updateMany).not.toHaveBeenCalled();
    });

    // ── Plafond à l'écriture ─────────────────────────────────────────────────

    it("ne supprime rien tant que le plafond de 20 appareils n'est pas atteint", async () => {
      mockPrisma.deviceToken.findMany.mockResolvedValue([
        { id: "d1" },
        { id: "d2" },
      ]);

      await service.registerDeviceToken("u1", "fcm-token", "IOS");

      expect(mockPrisma.deviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        select: { id: true },
        orderBy: { lastSeenAt: "desc" },
        take: 20,
      });
      expect(mockPrisma.deviceToken.deleteMany).not.toHaveBeenCalled();
    });

    it("supprime les appareils au-delà des 20 plus récents (borne du stock)", async () => {
      // Sans ce plafond, MAX_DEVICES_PER_USER ne bornait que la lecture : un
      // compte authentifié pouvait écrire une ligne par appel avec un token
      // aléatoire, jamais purgée.
      const keep = Array.from({ length: 20 }, (_, index) => ({
        id: `device-${index}`,
      }));
      mockPrisma.deviceToken.findMany.mockResolvedValue(keep);
      mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 7 });

      await service.registerDeviceToken("u1", "fcm-token", "IOS");

      expect(mockPrisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: "u1",
          id: { notIn: keep.map((device) => device.id) },
        },
      });
    });

    it("n'échoue pas quand le plafond est atteint sans rien à supprimer", async () => {
      mockPrisma.deviceToken.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, index) => ({ id: `device-${index}` })),
      );
      mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.registerDeviceToken("u1", "fcm-token", "IOS"),
      ).resolves.toBeUndefined();
    });
  });

  describe("purgeExpiredDeviceTokens", () => {
    it("supprime les tokens sans ré-enregistrement depuis 90 jours", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-09-07T12:00:00.000Z"));
      mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 3 });

      await expect(service.purgeExpiredDeviceTokens()).resolves.toBe(3);

      expect(mockPrisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { lastSeenAt: { lt: new Date("2026-06-09T12:00:00.000Z") } },
      });
    });

    it("retourne 0 quand rien n'est hors durée de conservation", async () => {
      mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.purgeExpiredDeviceTokens()).resolves.toBe(0);
    });
  });

  describe("unregisterDeviceToken", () => {
    it("supprime le token de l'utilisateur courant", async () => {
      mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 1 });

      const count = await service.unregisterDeviceToken("u1", "fcm-token");

      expect(mockPrisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: "fcm-token", userId: "u1" },
      });
      expect(count).toBe(1);
    });

    it("idempotent : 0 quand le token n'existe pas", async () => {
      mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.unregisterDeviceToken("u1", "unknown-token"),
      ).resolves.toBe(0);
    });

    it("ne touche pas le token d'un autre utilisateur (scoping userId)", async () => {
      mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 0 });

      const count = await service.unregisterDeviceToken(
        "attacker",
        "victim-token",
      );

      // Le userId fait partie du WHERE : la ligne de la victime ne matche pas.
      expect(mockPrisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: "victim-token", userId: "attacker" },
      });
      expect(count).toBe(0);
    });
  });

  describe("sendToUser", () => {
    it("alimente le feed in-app même sans appareil enregistré", async () => {
      withFirebaseApp();
      mockPrisma.deviceToken.findMany.mockResolvedValue([]);

      const result = await service.sendToUser("u1", "Titre", "Corps");

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: { userId: "u1", title: "Titre", body: "Corps", data: {} },
      });
      expect(sendMock()).not.toHaveBeenCalled();
      expect(result).toEqual({ sent: 0, failed: 0, pruned: 0 });
    });

    it("borne et trie la lecture des appareils (take + lastSeenAt desc)", async () => {
      withFirebaseApp();
      mockPrisma.deviceToken.findMany.mockResolvedValue([{ token: "t1" }]);

      await service.sendToUser("u1", "Titre", "Corps");

      expect(mockPrisma.deviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        select: { token: true },
        orderBy: { lastSeenAt: "desc" },
        take: 20,
      });
    });

    it("envoie à tous les appareils de l'utilisateur", async () => {
      withFirebaseApp();
      mockPrisma.deviceToken.findMany.mockResolvedValue([
        { token: "t1" },
        { token: "t2" },
      ]);

      const result = await service.sendToUser("u1", "Titre", "Corps", {
        k: "v",
      });

      expect(sendMock()).toHaveBeenCalledTimes(2);
      expect(sendMock()).toHaveBeenCalledWith({
        notification: { title: "Titre", body: "Corps" },
        token: "t1",
        data: { k: "v" },
      });
      expect(result).toEqual({ sent: 2, failed: 0, pruned: 0 });
      expect(mockPrisma.deviceToken.deleteMany).not.toHaveBeenCalled();
    });

    it("mode mock (sans credentials) : aucun envoi, aucun nettoyage", async () => {
      (service as unknown as { firebaseApp: App | null }).firebaseApp = null;
      mockPrisma.deviceToken.findMany.mockResolvedValue([{ token: "t1" }]);

      const result = await service.sendToUser("u1", "Titre", "Corps");

      expect(sendMock()).not.toHaveBeenCalled();
      expect(result).toEqual({ sent: 0, failed: 0, pruned: 0 });
    });

    it("supprime les tokens invalides et garde ceux en erreur transitoire", async () => {
      withFirebaseApp();
      mockPrisma.deviceToken.findMany.mockResolvedValue([
        { token: "alive" },
        { token: "uninstalled" },
        { token: "revoked" },
        { token: "flaky" },
      ]);
      sendMock().mockImplementation((message: Message) => {
        const token = "token" in message ? message.token : "";
        if (token === "uninstalled") {
          return Promise.reject(
            fcmError("messaging/registration-token-not-registered"),
          );
        }
        if (token === "revoked") {
          return Promise.reject(
            fcmError("messaging/invalid-registration-token"),
          );
        }
        if (token === "flaky") {
          return Promise.reject(fcmError("messaging/internal-error"));
        }
        return Promise.resolve("ok");
      });
      mockPrisma.deviceToken.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.sendToUser("u1", "Titre", "Corps");

      expect(mockPrisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ["uninstalled", "revoked"] } },
      });
      expect(result).toEqual({ sent: 1, failed: 1, pruned: 2 });
    });

    it("ne lève pas quand une erreur FCM n'a pas de code exploitable", async () => {
      withFirebaseApp();
      mockPrisma.deviceToken.findMany.mockResolvedValue([{ token: "t1" }]);
      sendMock().mockRejectedValue("boom");

      const result = await service.sendToUser("u1", "Titre", "Corps");

      expect(result).toEqual({ sent: 0, failed: 1, pruned: 0 });
      expect(mockPrisma.deviceToken.deleteMany).not.toHaveBeenCalled();
    });

    // ── Dégradation gracieuse (best-effort) ──────────────────────────────────

    it("dégrade en échec sans lever quand le circuit FCM est ouvert", async () => {
      withFirebaseApp();
      mockPrisma.deviceToken.findMany.mockResolvedValue([{ token: "t1" }]);
      mockCircuitBreaker.fire.mockRejectedValue(
        new ServiceUnavailableException(
          "Service fcm is temporarily unavailable. Please try again later.",
        ),
      );

      const result = await service.sendToUser("u1", "Titre", "Corps");

      expect(result).toEqual({ sent: 0, failed: 1, pruned: 0 });
      // Le feed in-app reste alimenté : c'est la partie qui compte.
      expect(mockPrisma.notification.create).toHaveBeenCalled();
    });

    it("borne un envoi FCM qui ne répond pas (timeout → échec)", async () => {
      jest.useFakeTimers();
      withFirebaseApp();
      mockPrisma.deviceToken.findMany.mockResolvedValue([{ token: "t1" }]);
      // FCM ne répond jamais : sans withTimeout, la requête HTTP resterait
      // suspendue sur autant d'appels sortants qu'il y a d'appareils.
      sendMock().mockReturnValue(new Promise(() => undefined));

      const pending = service.sendToUser("u1", "Titre", "Corps");
      await jest.advanceTimersByTimeAsync(5_000);

      await expect(pending).resolves.toEqual({
        sent: 0,
        failed: 1,
        pruned: 0,
      });
    });

    it("best-effort : une panne de la base sur la lecture des appareils ne remonte pas", async () => {
      // Un producteur métier appelle sendToUser depuis un chemin HTTP : l'envoi
      // push ne doit jamais faire échouer l'opération (validation d'inscription).
      withFirebaseApp();
      mockPrisma.deviceToken.findMany.mockRejectedValue(
        new Error("Can't reach database server"),
      );

      await expect(service.sendToUser("u1", "Titre", "Corps")).resolves.toEqual(
        { sent: 0, failed: 0, pruned: 0 },
      );
      expect(mockPrisma.notification.create).toHaveBeenCalled();
    });

    it("laisse remonter l'échec d'écriture du feed in-app", async () => {
      // Contrepartie du point précédent : sendToUser remplace createForUser chez
      // les producteurs, donc l'échec de CETTE écriture garde sa sémantique.
      mockPrisma.notification.create.mockRejectedValueOnce(
        new Error("Can't reach database server"),
      );

      await expect(service.sendToUser("u1", "Titre", "Corps")).rejects.toThrow(
        "Can't reach database server",
      );
    });
  });
});
