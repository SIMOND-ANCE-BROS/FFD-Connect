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
import { Throttle } from "@nestjs/throttler";
import { Request as ExpressRequest } from "express";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  RegisterDeviceTokenDto,
  UnregisterDeviceTokenDto,
} from "./dto/device-token.dto";
import { NotificationsService } from "./notifications.service";

interface RequestWithUser extends ExpressRequest {
  user: {
    userId: string;
    email: string;
  };
}

@ApiCommonErrorResponses()
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

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
      "Test de notification",
      "Si vous voyez ceci, les notifications push fonctionnent sur cet appareil.",
      { type: "test" },
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
}
