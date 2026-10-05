import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { DevicePlatform, NotificationType } from "@prisma/client";
import {
  cert,
  initializeApp,
  type App,
  type Credential,
  type ServiceAccount,
} from "firebase-admin/app";
import { getMessaging, type Message } from "firebase-admin/messaging";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  getErrorCode,
  getErrorMessage,
  getErrorStack,
} from "../utils/error.utils";
import {
  deviceTokenIdSelect,
  deviceTokenPushSelect,
} from "../utils/prisma-selects";
import { withTimeout } from "../utils/timeout.utils";
import { NotificationPreferencesQueryService } from "./notification-preferences.query-service";

/**
 * Codes d'erreur FCM qui signifient « ce token est mort » (app désinstallée,
 * token révoqué par Firebase, données de l'app effacées). Le token doit être
 * supprimé de la base, sinon la table grossit indéfiniment de tokens morts.
 * Les autres codes (quota, panne réseau, `messaging/internal-error`) sont
 * transitoires : on garde le token.
 */
const FCM_STALE_TOKEN_CODES: ReadonlySet<string> = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/**
 * Nombre max d'appareils conservés — et donc adressés — pour un même
 * utilisateur. Borne à la fois la LECTURE (`take` de l'envoi) et l'ÉCRITURE
 * (`enforceDeviceLimit` après chaque enregistrement) : l'unicité en base porte
 * sur le token, une chaîne arbitraire fournie par le client, donc rien
 * n'empêcherait sinon un compte valide d'écrire autant de lignes qu'il veut.
 */
const MAX_DEVICES_PER_USER = 20;

/**
 * Durée de conservation d'un token d'appareil sans ré-enregistrement
 * (RGPD art. 5.1.e — limitation de la conservation). Le client ré-enregistre à
 * chaque ouverture de session : 90 jours de silence signifient que l'appareil
 * n'est plus utilisé (application désinstallée, appareil remplacé).
 *
 * Documenté dans `docs/legal/politique-confidentialite.md` §5.
 */
const DEVICE_TOKEN_RETENTION_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Code Prisma d'une violation de contrainte d'unicité. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * Borne d'un envoi FCM unitaire. Volontairement court : l'envoi est best-effort
 * et peut s'ouvrir en éventail sur `MAX_DEVICES_PER_USER` appareils depuis un
 * chemin HTTP.
 */
const FCM_SEND_TIMEOUT_MS = 5_000;

/** Résultat d'un envoi unitaire à un token. */
type PushDelivery = "sent" | "stale" | "failed";

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp?: App;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly preferences: NotificationPreferencesQueryService,
  ) {}

  /**
   * Initialise Firebase Admin SDK au démarrage du module.
   *
   * Contrat : credentials **absents OU invalides** → mode mock. Toute la
   * résolution des credentials est protégée, pas seulement `initializeApp`.
   *
   * `cert()` est synchrone et lève (`Failed to parse private key.`) sur un PEM
   * malformé ou un fichier de clé absent/illisible, et `parseServiceAccount` ne
   * valide que la présence de trois chaînes non vides — jamais le format de la
   * clé. Un `\n` mal échappé dans `private_key` suffit donc à faire lever
   * `cert()`. Si cette exception remontait, l'initialisation du module NestJS
   * échouerait et le conteneur ne démarrerait pas : sur une rotation de secret
   * SANS redéploiement il n'existe aucune révision à rollbacker, et le backend
   * (minReplicas=0) crash-looperait à chaque réveil. Dégrader en mode mock est
   * la seule option qui garde le reste de l'API debout.
   */
  onModuleInit() {
    try {
      const credential = this.resolveFirebaseCredential();

      if (!credential) {
        this.logger.warn(
          "No Firebase credentials (FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_PATH). Mocking notifications.",
        );
        return;
      }

      this.firebaseApp = initializeApp({ credential });
      this.logger.log("Firebase Admin initialized successfully");
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const errorStack = getErrorStack(error);
      this.logger.error(
        `Failed to initialize Firebase Admin: ${errorMessage}`,
        errorStack,
      );
      this.logger.warn(
        "Firebase credentials are present but unusable. Mocking notifications (the API stays up).",
      );
    }
  }

  /**
   * Résout les credentials Firebase, par ordre de priorité :
   *
   * 1. `FIREBASE_SERVICE_ACCOUNT_JSON` — le contenu JSON complet du compte de
   *    service, injecté depuis Key Vault. C'est la seule forme utilisable sur
   *    Azure Container Apps : il n'y a pas de système de fichiers où déposer un
   *    fichier de clé, et l'ancienne clé référencée par un chemin a été révoquée.
   * 2. `FIREBASE_SERVICE_ACCOUNT_PATH` — chemin vers un fichier de clé, conservé
   *    en repli pour le développement local.
   *
   * Aucune des deux → `undefined`, le service reste en mode mock (pas de crash).
   *
   * Les deux appels `cert()` peuvent LEVER (PEM malformé, fichier illisible) :
   * l'exception est rattrapée par `onModuleInit`, qui bascule aussi en mode mock.
   */
  private resolveFirebaseCredential(): Credential | undefined {
    const serviceAccountJson = this.configService.get<string>(
      "FIREBASE_SERVICE_ACCOUNT_JSON",
    );

    if (serviceAccountJson) {
      const serviceAccount = this.parseServiceAccount(serviceAccountJson);
      if (serviceAccount) {
        return cert(serviceAccount);
      }
      this.logger.error(
        "FIREBASE_SERVICE_ACCOUNT_JSON is set but unusable (invalid JSON or missing project_id/client_email/private_key). Falling back to FIREBASE_SERVICE_ACCOUNT_PATH.",
      );
    }

    const serviceAccountPath = this.configService.get<string>(
      "FIREBASE_SERVICE_ACCOUNT_PATH",
    );

    return serviceAccountPath ? cert(serviceAccountPath) : undefined;
  }

  /**
   * Parse le JSON d'un compte de service Google. Accepte les clés snake_case du
   * fichier téléchargé depuis la console Firebase comme leur équivalent camelCase.
   *
   * @returns le compte de service, ou `undefined` si le JSON est invalide ou incomplet
   */
  private parseServiceAccount(raw: string): ServiceAccount | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Le message du parseur n'est JAMAIS journalisé : V8 recopie une fenêtre
      // du texte source autour du point de rupture. Si la rupture tombe dans
      // `private_key`, un fragment de PEM atterrirait dans Azure Log Analytics,
      // dont les droits de lecture sont plus larges que ceux de Key Vault. On
      // logue la longueur, qui suffit à distinguer « variable tronquée » de
      // « variable mal échappée ».
      this.logger.error(
        `Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: not valid JSON (${raw.length} characters read; content not logged)`,
      );
      return undefined;
    }

    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    const json = parsed as Record<string, unknown>;
    const readString = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = json[key];
        if (typeof value === "string" && value.length > 0) return value;
      }
      return undefined;
    };

    const projectId = readString("project_id", "projectId");
    const clientEmail = readString("client_email", "clientEmail");
    const privateKey = readString("private_key", "privateKey");

    if (!projectId || !clientEmail || !privateKey) {
      return undefined;
    }

    return {
      projectId,
      clientEmail,
      // Les secrets injectés par variable d'environnement arrivent souvent avec
      // des retours à la ligne doublement échappés : la clé PEM serait rejetée.
      privateKey: privateKey.replace(/\\n/g, "\n"),
    };
  }

  /**
   * Envoie un message à un token, sans écriture en base, sans jamais rejeter.
   *
   * Service externe (convention projet / ADR-0009) : circuit breaker opossum +
   * `withTimeout`, avec dégradation gracieuse. `sendToUser` adresse jusqu'à
   * `MAX_DEVICES_PER_USER` appareils en parallèle depuis un chemin HTTP — sans
   * borne, un ralentissement de FCM suspendrait autant d'appels sortants dans la
   * requête. Un circuit ouvert ou un timeout est traité comme n'importe quel
   * autre échec : `"failed"`, jamais une exception qui remonterait au producteur.
   *
   * @returns `"sent"`, `"stale"` (token mort côté FCM → à supprimer) ou `"failed"`
   */
  private async deliverToToken(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<PushDelivery> {
    const message: Message = {
      notification: { title, body },
      token,
      data: data ?? {},
    };

    try {
      const response = await this.circuitBreakerService.fire("fcm", () =>
        withTimeout(
          getMessaging().send(message),
          FCM_SEND_TIMEOUT_MS,
          "FCM.send",
        ),
      );
      this.logger.log(`Successfully sent message: ${response}`);
      return "sent";
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const errorStack = getErrorStack(error);
      const errorCode = getErrorCode(error);

      if (errorCode && FCM_STALE_TOKEN_CODES.has(errorCode)) {
        this.logger.warn(`Stale FCM token (${errorCode}), will be removed`);
        return "stale";
      }

      this.logger.error(`Error sending message: ${errorMessage}`, errorStack);
      return "failed";
    }
  }

  /**
   * Envoie une notification push à un appareil spécifique
   *
   * Cette méthode envoie une notification push Firebase à un appareil identifié
   * par son token FCM. La notification est également enregistrée dans la base
   * de données pour l'historique.
   *
   * @param token - Token FCM de l'appareil destinataire
   * @param title - Titre de la notification
   * @param body - Corps du message de la notification
   * @param data - Données additionnelles optionnelles à envoyer avec la notification
   * @param userId - ID de l'utilisateur destinataire (optionnel, pour l'historique)
   *
   * @example
   * ```typescript
   * await notificationsService.sendToDevice(
   *   'fcm-token-123',
   *   'Nouvelle compétition',
   *   'Une nouvelle compétition a été ajoutée',
   *   { competitionId: 'comp-123' },
   *   'user-456'
   * );
   * ```
   */
  async sendToDevice(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    userId?: string,
  ) {
    // Store in DB
    await this.prisma.notification.create({
      data: {
        userId,
        title,
        body,
        data: data ?? {},
      },
    });

    if (!this.firebaseApp) {
      // Le token n'est jamais journalisé : c'est un identifiant d'appareil
      // (donnée personnelle), et le mode mock est actif dès que les credentials
      // manquent — y compris en staging et en production.
      this.logger.log(`[MOCK] Sending notification to 1 device: ${title}`);
      return;
    }

    const delivery = await this.deliverToToken(token, title, body, data);
    if (delivery === "stale") {
      // Le token peut ne pas être en base (envoi à un token fourni par
      // l'appelant) : deleteMany est idempotent.
      await this.pruneStaleTokens([token]);
    }
  }

  /**
   * Envoie une notification push à un topic Firebase
   *
   * Cette méthode envoie une notification push à tous les appareils abonnés
   * à un topic Firebase. Utile pour les notifications globales ou par catégorie.
   * La notification est enregistrée dans la base de données comme notification globale.
   *
   * @param topic - Nom du topic Firebase (ex: "competitions", "all-users")
   * @param title - Titre de la notification
   * @param body - Corps du message de la notification
   * @param data - Données additionnelles optionnelles à envoyer avec la notification
   *
   * @example
   * ```typescript
   * await notificationsService.sendToTopic(
   *   'competitions',
   *   'Nouvelle compétition',
   *   'Une nouvelle compétition est disponible',
   *   { competitionId: 'comp-123' }
   * );
   * ```
   */
  async sendToTopic(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    const message: Message = {
      notification: { title, body },
      topic,
      data: data ?? {},
    };

    // For topic, we don't necessarily have a single userId.
    // We store it as a global notification (userId null).
    await this.prisma.notification.create({
      data: {
        title,
        body,
        data: data ?? {},
      },
    });

    if (!this.firebaseApp) {
      this.logger.log(
        `[MOCK] Sending notification to topic ${topic}: ${title} - ${body}`,
      );
      return;
    }

    try {
      // Même protection que `deliverToToken` : FCM est un service externe.
      const response = await this.circuitBreakerService.fire("fcm", () =>
        withTimeout(
          getMessaging().send(message),
          FCM_SEND_TIMEOUT_MS,
          "FCM.sendToTopic",
        ),
      );
      this.logger.log(
        `Successfully sent message to topic ${topic}: ${response}`,
      );
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const errorStack = getErrorStack(error);
      this.logger.error(
        `Error sending message to topic ${topic}: ${errorMessage}`,
        errorStack,
      );
    }
  }

  /**
   * Crée une notification pour un utilisateur (stockée en base, visible dans l'app).
   * Utilisé pour les notifications métier (inscriptions, validations, etc.).
   *
   * Le feed in-app n'est JAMAIS filtré par les préférences : `type` n'est ici
   * qu'une étiquette, elle ne conditionne que la push (cf. `sendToUser`).
   *
   * @param userId - Destinataire
   * @param type - Type d'événement du catalogue
   * @param title - Titre affiché
   * @param body - Corps du message
   * @param data - Données additionnelles (routage du deep-link côté client)
   */
  async createForUser(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    return this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        data: data ?? {},
      },
    });
  }

  /**
   * Crée la même notification (titre/corps/data) pour plusieurs utilisateurs en
   * une seule requête (createMany). Utilisé pour les diffusions issues de la
   * synchro (nouvelle compétition, résultats) afin d'éviter le N+1.
   */
  async createManyForUsers(
    userIds: string[],
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    if (userIds.length === 0) return { count: 0 };
    return this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type,
        title,
        body,
        data: data ?? {},
      })),
    });
  }

  /**
   * Récupère toutes les notifications d'un utilisateur
   *
   * Récupère les notifications personnelles de l'utilisateur ainsi que les notifications
   * globales (sans userId). Les notifications sont triées par date de création (plus récentes en premier)
   * et limitées à 50 résultats.
   *
   * @param userId - ID de l'utilisateur dont on veut récupérer les notifications
   * @returns Liste des notifications (personnelles + globales) triées par date décroissante
   *
   * @example
   * ```typescript
   * const notifications = await notificationsService.getAllForUser('user-123');
   * notifications.forEach(notif => {
   *   this.logger.log(`${notif.title}: ${notif.body}`);
   * });
   * ```
   */
  async getAllForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: {
        OR: [
          { userId },
          { userId: null }, // Global notifications
        ],
      },
      select: {
        id: true,
        userId: true,
        title: true,
        body: true,
        data: true,
        isRead: true,
        createdAt: true,
        // Exclure les champs non nécessaires si présents dans le schéma
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  /**
   * Marque une notification spécifique comme lue
   *
   * @param notificationId - ID de la notification à marquer comme lue
   * @param userId - ID de l'utilisateur propriétaire de la notification
   * @returns Nombre de notifications mises à jour (0 ou 1)
   *
   * @example
   * ```typescript
   * await notificationsService.markAsRead('notif-123', 'user-456');
   * ```
   */
  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  }

  /**
   * Marque toutes les notifications non lues d'un utilisateur comme lues
   *
   * @param userId - ID de l'utilisateur dont on veut marquer toutes les notifications comme lues
   * @returns Nombre de notifications mises à jour
   *
   * @example
   * ```typescript
   * const count = await notificationsService.markAllAsRead('user-123');
   * this.logger.log(`${count} notifications marquées comme lues`);
   * ```
   */
  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  // ─── Tokens d'appareil (FCM) ───────────────────────────────────────────────

  /**
   * Enregistre (ou rafraîchit) le token FCM d'un appareil pour un utilisateur.
   *
   * Upsert sur le token, qui est unique : un appareil = une seule ligne. Si le
   * token était lié à un AUTRE utilisateur (appareil partagé, appareil revendu,
   * ou simple changement de compte), il est ré-attribué à l'utilisateur courant.
   * C'est le comportement voulu : sans ça, les notifications du précédent
   * propriétaire continueraient d'arriver sur cet appareil.
   *
   * Après l'écriture, le nombre d'appareils est plafonné à
   * `MAX_DEVICES_PER_USER` (cf. `enforceDeviceLimit`).
   *
   * @param userId - Utilisateur authentifié à qui rattacher l'appareil
   * @param token - Token de registration FCM
   * @param platform - Plateforme de l'appareil (IOS / ANDROID)
   */
  async registerDeviceToken(
    userId: string,
    token: string,
    platform: DevicePlatform,
  ): Promise<void> {
    try {
      await this.prisma.deviceToken.upsert({
        where: { token },
        create: { userId, token, platform },
        // lastSeenAt est @updatedAt, mais on le pose explicitement : le client
        // ré-enregistre à chaque ouverture de session et c'est ce champ qui dit
        // quels appareils sont encore actifs.
        update: { userId, platform, lastSeenAt: new Date() },
      });
    } catch (error: unknown) {
      if (getErrorCode(error) !== PRISMA_UNIQUE_VIOLATION) {
        throw error;
      }
      // Course sur la contrainte unique : l'upsert Prisma n'est pas atomique
      // quand le champ unique n'est pas l'`@id`, et deux enregistrements du même
      // token peuvent se croiser (l'ouverture de session déclenche
      // l'enregistrement pendant que FCM déclenche `onTokenRefresh`). Sans ce
      // rattrapage : 500 dans Sentry et enregistrement perdu, puisque le client
      // ne retente pas (par design). La ligne existe désormais : un update
      // suffit. `updateMany` plutôt qu'`update` pour rester idempotent si la
      // ligne a disparu entre-temps (désenregistrement concurrent).
      this.logger.warn(
        "Device token registration lost a unique-constraint race (P2002), retrying as update",
      );
      await this.prisma.deviceToken.updateMany({
        where: { token },
        data: { userId, platform, lastSeenAt: new Date() },
      });
    }

    await this.enforceDeviceLimit(userId);
  }

  /**
   * Plafonne à l'ÉCRITURE le nombre d'appareils d'un utilisateur : on garde les
   * `MAX_DEVICES_PER_USER` vus le plus récemment (`lastSeenAt`) et on supprime
   * le reste.
   *
   * Sans ce plafond, `MAX_DEVICES_PER_USER` ne bornait que la lecture : un
   * compte authentifié pouvait boucler sur `POST /notifications/device-token`
   * avec un token aléatoire à chaque appel — l'unicité porte sur le token, une
   * chaîne arbitraire fournie par le client — et écrire des dizaines de milliers
   * de lignes que rien ne purgeait. Le throttle de l'endpoint limite le débit,
   * ce plafond borne le stock.
   *
   * @returns le nombre de lignes supprimées
   */
  private async enforceDeviceLimit(userId: string): Promise<number> {
    const keep = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: deviceTokenIdSelect,
      orderBy: { lastSeenAt: "desc" },
      take: MAX_DEVICES_PER_USER,
    });

    // Cas courant (1 à 2 appareils) : rien à supprimer, pas de requête inutile.
    if (keep.length < MAX_DEVICES_PER_USER) return 0;

    const { count } = await this.prisma.deviceToken.deleteMany({
      where: { userId, id: { notIn: keep.map((device) => device.id) } },
    });

    if (count > 0) {
      this.logger.warn(
        `Device cap reached for user ${userId}: dropped ${count} older device token(s)`,
      );
    }
    return count;
  }

  /**
   * Purge les tokens d'appareil qui n'ont pas été ré-enregistrés depuis
   * `DEVICE_TOKEN_RETENTION_DAYS` jours (RGPD art. 5.1.e — limitation de la
   * durée de conservation).
   *
   * Le nettoyage sur retour FCM (`pruneStaleTokens`) ne suffit pas : il dépend
   * d'un envoi, et un token sorti du top `MAX_DEVICES_PER_USER` ne reçoit plus
   * rien — il ne peut donc jamais être déclaré mort par FCM et resterait du
   * poids mort permanent. Une désinstallation, par ailleurs, ne déclenche aucune
   * déconnexion : chaque réinstallation laisse une ligne orpheline.
   *
   * Appelée par le cron horaire existant (`SessionCleanupService`) : aucune
   * planification supplémentaire, donc aucun réveil du conteneur scale-to-zero —
   * la purge ne tourne que si une réplique est déjà vivante.
   *
   * @returns le nombre de tokens supprimés
   */
  async purgeExpiredDeviceTokens(): Promise<number> {
    const cutoff = new Date(
      Date.now() - DEVICE_TOKEN_RETENTION_DAYS * MS_PER_DAY,
    );

    const { count } = await this.prisma.deviceToken.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });

    if (count > 0) {
      this.logger.log(
        `Purged ${count} device token(s) unseen for ${DEVICE_TOKEN_RETENTION_DAYS} days`,
      );
    }
    return count;
  }

  /**
   * Retire le token d'un appareil (déconnexion).
   *
   * Scoping sur `userId` : un utilisateur ne peut désenregistrer que ses propres
   * appareils. Idempotent — un token inconnu, ou appartenant à quelqu'un
   * d'autre, ne fait rien et ne lève pas.
   *
   * @returns le nombre de tokens supprimés (0 ou 1)
   */
  async unregisterDeviceToken(userId: string, token: string): Promise<number> {
    const { count } = await this.prisma.deviceToken.deleteMany({
      where: { token, userId },
    });
    return count;
  }

  /**
   * Envoie une notification push à tous les appareils enregistrés d'un
   * utilisateur, et crée l'entrée correspondante dans son feed in-app.
   *
   * Les tokens que FCM rejette comme définitivement invalides (application
   * désinstallée, token révoqué) sont supprimés de la base : sans ce nettoyage,
   * la table accumulerait indéfiniment des tokens morts.
   *
   * L'envoi push est **best-effort** : ni un échec FCM, ni un circuit ouvert, ni
   * une erreur de nettoyage ne remontent à l'appelant. Seule l'écriture du feed
   * in-app peut faire échouer l'appel — c'est la substitution exacte de
   * `createForUser`, que les producteurs métier appelaient jusqu'ici.
   *
   * La préférence de l'utilisateur pour `type` n'arbitre QUE la push. Le feed
   * in-app est écrit avant d'être consultée : couper un type réduit au silence
   * le téléphone, jamais la cloche (critère d'acceptation de l'issue #37).
   *
   * @param userId - Utilisateur destinataire
   * @param type - Type d'événement du catalogue, confronté aux préférences
   * @param title - Titre de la notification
   * @param body - Corps du message
   * @param data - Données additionnelles optionnelles
   * @returns Compteurs d'envois réussis, échoués et de tokens supprimés
   *
   * @example
   * ```typescript
   * await notificationsService.sendToUser(
   *   'user-123',
   *   NotificationType.REGISTRATION_STATUS,
   *   'Inscription confirmée',
   *   'Votre inscription à la compétition est validée',
   *   { competitionId: 'comp-123' },
   * );
   * ```
   */
  async sendToUser(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ sent: number; failed: number; pruned: number }> {
    // Le feed in-app est alimenté même sans appareil enregistré, et AVANT toute
    // consultation des préférences. C'est la partie qui compte : son échec
    // remonte à l'appelant, comme celui de `createForUser` qu'elle remplace
    // chez les producteurs.
    await this.createForUser(userId, type, title, body, data);

    try {
      if (!(await this.preferences.isPushEnabled(userId, type))) {
        this.logger.debug(
          `Push suppressed for user ${userId} (${type} disabled); in-app feed written`,
        );
        return { sent: 0, failed: 0, pruned: 0 };
      }

      return await this.pushToUserDevices(userId, title, body, data);
    } catch (error: unknown) {
      // Best-effort : l'envoi push ne doit JAMAIS faire échouer l'opération
      // métier qui l'a déclenchée (validation d'inscription, etc.). Les échecs
      // FCM unitaires sont déjà absorbés par `deliverToToken` ; ce filet couvre
      // le reste (lecture des préférences, lecture des appareils, nettoyage).
      //
      // Une lecture de préférence en échec ne part donc PAS quand même : on
      // échoue fermé. Envoyer sans avoir pu vérifier le consentement coûterait
      // plus cher qu'une push perdue, dont le contenu reste dans la cloche.
      this.logger.error(
        `Push delivery failed for user ${userId}: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
      return { sent: 0, failed: 0, pruned: 0 };
    }
  }

  /**
   * Corps de l'envoi push de `sendToUser` : lecture des appareils, envoi en
   * parallèle, nettoyage des tokens morts. Peut rejeter — l'appelant dégrade.
   */
  private async pushToUserDevices(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ sent: number; failed: number; pruned: number }> {
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: deviceTokenPushSelect,
      orderBy: { lastSeenAt: "desc" },
      take: MAX_DEVICES_PER_USER,
    });

    if (devices.length === 0) {
      return { sent: 0, failed: 0, pruned: 0 };
    }

    if (!this.firebaseApp) {
      this.logger.log(
        `[MOCK] Sending notification to ${devices.length} device(s) of user ${userId}: ${title} - ${body}`,
      );
      return { sent: 0, failed: 0, pruned: 0 };
    }

    const deliveries = await Promise.all(
      devices.map(async (device) => ({
        token: device.token,
        result: await this.deliverToToken(device.token, title, body, data),
      })),
    );

    const staleTokens = deliveries
      .filter((delivery) => delivery.result === "stale")
      .map((delivery) => delivery.token);

    const pruned = await this.pruneStaleTokens(staleTokens);

    return {
      sent: deliveries.filter((delivery) => delivery.result === "sent").length,
      failed: deliveries.filter((delivery) => delivery.result === "failed")
        .length,
      pruned,
    };
  }

  /**
   * Supprime les tokens que FCM a déclarés définitivement invalides.
   *
   * Non scopé sur un utilisateur : un token mort est mort pour tout le monde.
   *
   * @returns le nombre de tokens réellement supprimés
   */
  private async pruneStaleTokens(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0;

    const { count } = await this.prisma.deviceToken.deleteMany({
      where: { token: { in: tokens } },
    });

    if (count > 0) {
      this.logger.log(`Pruned ${count} stale device token(s)`);
    }
    return count;
  }
}
