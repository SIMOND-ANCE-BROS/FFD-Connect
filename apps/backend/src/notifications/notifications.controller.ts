import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { NotificationType } from "@prisma/client";
import { Throttle } from "@nestjs/throttler";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  RegisterDeviceTokenDto,
  UnregisterDeviceTokenDto,
} from "./dto/device-token.dto";
import { DeletedCountDto } from "./dto/deleted-count.dto";
import {
  NotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
} from "./dto/notification-preference.dto";
import { NotificationPreferencesQueryService } from "./notification-preferences.query-service";
import { NotificationPreferencesService } from "./notification-preferences.service";
import { NotificationsService } from "./notifications.service";

@ApiCommonErrorResponses()
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly preferencesQueryService: NotificationPreferencesQueryService,
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  @Get()
  async getMyNotifications(@Request() req: RequestWithUser) {
    return this.notificationsService.getAllForUser(req.user.userId);
  }

  @Patch(":id/read")
  async markAsRead(@Param("id") id: string, @Request() req: RequestWithUser) {
    return this.notificationsService.markAsRead(id, req.user.userId);
  }

  @Post("read-all")
  async markAllAsRead(@Request() req: RequestWithUser) {
    return this.notificationsService.markAllAsRead(req.user.userId);
  }

  /**
   * Envoi d'une notification de test à SES PROPRES appareils.
   *
   * La chaîne push est silencieuse par conception : sans credentials Firebase
   * le backend dégrade en mode mock, sans entitlement APNs le client ne produit
   * aucun token, et dans les deux cas rien ne remonte à l'utilisateur. Il
   * n'existait aucun moyen de savoir où la chaîne casse sans provoquer un vrai
   * événement métier.
   *
   * Le compteur renvoyé est le diagnostic : `sent: 0` signifie qu'aucun
   * appareil n'est enregistré (token jamais produit — entitlement ou build),
   * tandis qu'un `failed` non nul pointe un token mort ou un souci côté FCM.
   *
   * Volontairement limité à l'appelant : aucun paramètre de destinataire, donc
   * aucun moyen d'arroser quelqu'un d'autre.
   */
  @Post("test")
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Envoie une notification de test à ses propres appareils",
    description:
      "Diagnostic de la chaîne push. Renvoie le nombre d'appareils atteints : " +
      "sent=0 signifie qu'aucun token n'est enregistré pour ce compte.",
  })
  @ApiResponse({
    status: 201,
    description: "Compteurs d'envoi",
    schema: {
      example: { sent: 1, failed: 0, pruned: 0 },
    },
  })
  async sendTestNotification(@Request() req: RequestWithUser) {
    return this.notificationsService.sendToUser(
      req.user.userId,
      NotificationType.DIAGNOSTIC_TEST,
      "Test de notification",
      "Si vous voyez ceci, les notifications push fonctionnent sur cet appareil.",
      { type: "test" },
    );
  }

  // ─── Préférences de notification ───────────────────────────────────────────

  /**
   * Catalogue des types réglables qui concernent l'appelant, avec l'état
   * effectif de chacun et sa copie en français.
   *
   * Libellés ET périmètre de rôle sont résolus ici, pour que l'écran de
   * réglages se contente de dérouler la réponse : il ne connaît ni l'enum ni
   * les rôles. Un type ajouté plus tard, ou un périmètre modifié, s'applique
   * sans publier de nouvelle version de l'application mobile.
   */
  @Get("preferences")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Catalogue des préférences de notification de l'utilisateur",
    description:
      "Un élément par type réglable CONCERNANT LE RÔLE de l'appelant, dans l'ordre d'affichage : un licencié ne se voit pas proposer les notifications réservées aux gestionnaires de club ou à la modération. `enabled` vaut le choix enregistré s'il existe, le défaut documenté sinon — un compte qui n'a jamais ouvert ses réglages n'a aucune ligne en base. Les réglages d'un type devenu hors périmètre sont conservés et réapparaissent si le rôle le redevient.",
  })
  @ApiResponse({
    status: 200,
    description: "Catalogue des préférences",
    type: [NotificationPreferenceDto],
  })
  async getMyPreferences(
    @Request() req: RequestWithUser,
  ): Promise<NotificationPreferenceDto[]> {
    return this.preferencesQueryService.getCatalogForUser(
      req.user.userId,
      req.user.roles,
    );
  }

  /**
   * Bascule un interrupteur de l'écran de réglages.
   *
   * Limité à 30 appels par minute et par utilisateur : largement au-dessus
   * d'un passage sur l'écran de réglages (un appel par interrupteur basculé),
   * mais le point d'écriture mérite une borne propre — le throttle global
   * (100 req/min) couvre toute l'API, pas ce seul endpoint.
   */
  @Patch("preferences")
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Règle la réception des push d'un type de notification",
    description:
      "Idempotent. N'affecte que les notifications push : le feed in-app (la cloche) continue d'être alimenté pour tous les types. Un type non réglable est refusé (400), un type qui ne concerne pas le rôle de l'appelant également (403).",
  })
  @ApiBody({ type: UpdateNotificationPreferenceDto })
  @ApiResponse({
    status: 200,
    description: "Préférence enregistrée",
    type: NotificationPreferenceDto,
  })
  async updateMyPreference(
    @Body() dto: UpdateNotificationPreferenceDto,
    @Request() req: RequestWithUser,
  ): Promise<NotificationPreferenceDto> {
    return this.preferencesService.setPreference(
      req.user.userId,
      req.user.roles,
      dto.type,
      dto.enabled,
    );
  }

  @Post("device-token")
  // Le client légitime appelle une fois par ouverture de session et par
  // renouvellement du token par FCM. Sans cette limite, un compte authentifié
  // pouvait écrire ~144 000 lignes/jour sous le seul throttle global
  // (100 req/min), chacune avec un token aléatoire donc unique.
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Enregistre l'appareil courant pour les notifications push",
    description:
      "Appelé par le client à l'ouverture de session et au renouvellement du token FCM. Idempotent : l'upsert se fait sur le token, qui est ré-attribué à l'utilisateur authentifié s'il était lié à un autre compte (appareil partagé ou revendu). Limité à 5 appels par minute et par utilisateur ; au-delà de 20 appareils, les plus anciens (lastSeenAt) sont supprimés.",
  })
  @ApiBody({ type: RegisterDeviceTokenDto })
  @ApiResponse({ status: 204, description: "Appareil enregistré" })
  async registerDeviceToken(
    @Body() dto: RegisterDeviceTokenDto,
    @Request() req: RequestWithUser,
  ): Promise<void> {
    await this.notificationsService.registerDeviceToken(
      req.user.userId,
      dto.token,
      dto.platform,
    );
  }

  @Delete("device-token")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Retire l'appareil courant des destinataires push",
    description:
      "Appelé à la déconnexion. Ne désenregistre que si le token appartient à l'utilisateur authentifié. Idempotent : 204 même si le token est inconnu.",
  })
  @ApiBody({ type: UnregisterDeviceTokenDto })
  @ApiResponse({ status: 204, description: "Appareil retiré (ou déjà absent)" })
  async unregisterDeviceToken(
    @Body() dto: UnregisterDeviceTokenDto,
    @Request() req: RequestWithUser,
  ): Promise<void> {
    await this.notificationsService.unregisterDeviceToken(
      req.user.userId,
      dto.token,
    );
  }

  // ─── Suppression du feed ───────────────────────────────────────────────────
  //
  // DÉCLARÉES EN DERNIER, APRÈS `@Delete("device-token")`, ET PAS AILLEURS :
  // Nest résout les routes dans l'ordre de déclaration, donc un `@Delete(":id")`
  // placé plus haut capterait `DELETE /notifications/device-token` avec
  // id="device-token" et casserait la déconnexion sans rien casser de visible
  // à la compilation ni aux tests unitaires du contrôleur.

  /**
   * Vide le feed personnel de l'appelant.
   *
   * Sur la collection, donc sans `:id` : n'entre pas en concurrence avec les
   * routes nommées ci-dessus.
   */
  @Delete()
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Supprime toutes ses notifications",
    description:
      "Efface le feed personnel de l'appelant, lues comme non lues. Les annonces globales, qui n'appartiennent à aucun compte, ne sont pas concernées. Idempotent : un feed déjà vide renvoie `count: 0`.",
  })
  @ApiResponse({
    status: 200,
    description: "Nombre de notifications supprimées",
    type: DeletedCountDto,
  })
  async deleteAllMyNotifications(
    @Request() req: RequestWithUser,
  ): Promise<DeletedCountDto> {
    return this.notificationsService.deleteAllForUser(req.user.userId);
  }

  /**
   * Supprime une notification de son propre feed.
   *
   * 204 quoi qu'il arrive, y compris sur un identifiant inconnu ou appartenant
   * à quelqu'un d'autre : le code de retour ne renseigne pas sur l'existence
   * d'une notification tierce, et un double appui n'a pas à produire une erreur
   * pour une suppression qui a bien eu lieu.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Supprime une de ses notifications",
    description:
      "Ne supprime que si la notification appartient à l'appelant. Idempotent : 204 même si elle est déjà supprimée, inconnue, ou appartient à un autre compte.",
  })
  @ApiResponse({
    status: 204,
    description: "Notification supprimée (ou déjà absente)",
  })
  async deleteMyNotification(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ): Promise<void> {
    await this.notificationsService.deleteForUser(id, req.user.userId);
  }
}
