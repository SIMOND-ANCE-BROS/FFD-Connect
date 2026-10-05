import {
  Body,
  Controller,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { AuthPasswordService } from "./auth-password.service";
import { AuthService } from "./auth.service";
import { AuthTokenService } from "./auth-token.service";
import { Roles } from "./decorators/roles.decorator";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ImpersonateDto } from "./dto/impersonate.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { RolesGuard } from "./guards/roles.guard";
import type { RequestWithUser } from "./interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { NoImpersonationGuard } from "./no-impersonation.guard";

@ApiTags("auth")
@Controller("auth")
@ApiCommonErrorResponses()
export class AuthController {
  constructor(
    private authService: AuthService,
    private authTokenService: AuthTokenService,
    private authPasswordService: AuthPasswordService,
  ) {}

  @Post("register")
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: "Inscription avec vérification de licence FFD",
    description:
      "Crée un compte utilisateur en vérifiant que le numéro de licence FFD existe, est valide, et n'est pas déjà associé à un compte.",
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: "Inscription réussie",
  })
  @ApiResponse({
    status: 400,
    description: "Mot de passe invalide ou licence expirée",
  })
  @ApiResponse({
    status: 404,
    description: "Numéro de licence introuvable",
  })
  @ApiResponse({
    status: 409,
    description: "Email ou licence déjà utilisé",
  })
  async register(
    @Body() body: RegisterDto,
  ): Promise<import("./auth.service").LoginResponse> {
    return this.authService.register(
      body.email,
      body.password,
      body.licenseNumber,
      body.lastName,
      body.firstName,
    );
  }

  @Post("login")
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: "Authentifie un utilisateur",
    description:
      "Valide les identifiants (username/email et mot de passe) et retourne un access token JWT, un refresh token ainsi que les informations de l'utilisateur.",
  })
  // @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: "Authentification réussie",
    schema: {
      type: "object",
      properties: {
        access_token: {
          type: "string",
          description:
            "Token JWT pour l'authentification des requêtes suivantes (expire en 60 minutes)",
          example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        },
        refresh_token: {
          type: "string",
          description:
            "Refresh token pour obtenir un nouveau access token (expire en 30 jours)",
          example: "a1b2c3d4e5f6...",
        },
        user: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            role: {
              type: "string",
              enum: ["LICENSEE", "CLUB", "STAFF", "ADMIN"],
            },
            clubName: { type: "string", nullable: true },
            licenseNumber: { type: "string", nullable: true },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Identifiants invalides",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 401 },
        message: { type: "string", example: "Invalid credentials" },
        error: { type: "string", example: "Unauthorized" },
        timestamp: { type: "string", example: "2026-02-11T17:00:00.000Z" },
        path: { type: "string", example: "/auth/login" },
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: "Trop de tentatives de connexion. Rate limit dépassé.",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 429 },
        message: { type: "string", example: "Too many requests" },
      },
    },
  })
  async login(
    @Body() body: LoginDto,
  ): Promise<import("./auth.service").LoginResponse> {
    const user = await this.authService.validateUser(
      body.username,
      body.password,
    );
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return this.authService.login(user);
  }

  @Post("refresh")
  @ApiOperation({
    summary: "Rafraîchit un access token",
    description:
      "Utilise un refresh token valide pour obtenir un nouveau access token et un nouveau refresh token. Implémente la rotation des tokens pour la sécurité.",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        refresh_token: {
          type: "string",
          description: "Le refresh token à utiliser",
          example: "a1b2c3d4e5f6...",
        },
      },
      required: ["refresh_token"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Tokens rafraîchis avec succès",
    schema: {
      type: "object",
      properties: {
        access_token: {
          type: "string",
          description: "Nouveau access token JWT",
        },
        refresh_token: {
          type: "string",
          description: "Nouveau refresh token (l'ancien est révoqué)",
        },
        user: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            role: { type: "string" },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Refresh token invalide, expiré ou révoqué",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 401 },
        message: {
          type: "string",
          example: "Invalid or expired refresh token",
        },
        error: { type: "string", example: "Unauthorized" },
      },
    },
  })
  async refresh(
    @Body() body: RefreshTokenDto,
  ): Promise<import("./auth.service").LoginResponse> {
    return this.authTokenService.refreshAccessToken(body.refresh_token);
  }

  @Post("logout")
  @ApiOperation({
    summary: "Déconnexion",
    description:
      "Révoque un refresh token pour déconnecter l'utilisateur de manière sécurisée.",
  })
  @ApiBearerAuth("JWT-auth")
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: "Déconnexion réussie",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
        message: { type: "string", example: "Logged out successfully" },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Refresh token invalide",
  })
  async logout(
    @Body() body: RefreshTokenDto,
  ): Promise<{ success: boolean; message: string }> {
    const revoked = await this.authTokenService.revokeRefreshToken(
      body.refresh_token,
    );
    if (!revoked) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    return {
      success: true,
      message: "Logged out successfully",
    };
  }

  @Post("forgot-password")
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({
    summary: "Demande de réinitialisation de mot de passe",
    description:
      "Envoie un email avec un lien de réinitialisation de mot de passe. Pour des raisons de sécurité, ne révèle pas si l'email existe ou non.",
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({
    status: 200,
    description: "Email de réinitialisation envoyé (si l'email existe)",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
      },
    },
  })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authPasswordService.forgotPassword(body.email);
  }

  @Post("reset-password")
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: "Réinitialise le mot de passe avec un token",
    description:
      "Réinitialise le mot de passe en utilisant le token reçu par email. Le token expire après 1 heure.",
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: "Mot de passe réinitialisé avec succès",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Token invalide, expiré ou déjà utilisé, ou mot de passe invalide",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 400 },
        message: { type: "string" },
        errors: {
          type: "array",
          items: { type: "string" },
          description: "Liste des erreurs de validation du mot de passe",
        },
      },
    },
  })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authPasswordService.resetPassword(body.token, body.newPassword);
  }

  @Post("change-password")
  @UseGuards(JwtAuthGuard, NoImpersonationGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Change le mot de passe (utilisateur authentifié)",
    description:
      "Permet à un utilisateur authentifié de changer son mot de passe. Nécessite le mot de passe actuel.",
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: "Mot de passe modifié avec succès",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Mot de passe actuel incorrect",
  })
  @ApiResponse({
    status: 400,
    description:
      "Le nouveau mot de passe ne respecte pas la politique de sécurité",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 400 },
        message: { type: "string" },
        errors: {
          type: "array",
          items: { type: "string" },
          description: "Liste des erreurs de validation du mot de passe",
        },
      },
    },
  })
  async changePassword(
    @Request() req: RequestWithUser,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authPasswordService.changePassword(
      req.user.userId,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Post("impersonate")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Se connecter en tant qu'un autre utilisateur (impersonation)",
    description:
      "Phase 1 : réservé aux ADMIN. Retourne un access token court (15 min) dont l'identité est la cible, avec un claim d'audit. Interdit de cibler un admin. Actions destructives bloquées sous impersonation. Journalisé (RGPD).",
  })
  @ApiBody({ type: ImpersonateDto })
  @ApiResponse({ status: 201, description: "Token d'impersonation émis" })
  @ApiResponse({ status: 403, description: "Non autorisé / cible interdite" })
  @ApiResponse({ status: 404, description: "Cible introuvable" })
  async impersonate(
    @Request() req: RequestWithUser,
    @Body() body: ImpersonateDto,
  ) {
    return this.authService.impersonate(
      req.user.userId,
      req.user.role,
      { userId: body.targetUserId, email: body.targetEmail },
      body.reason,
      req.ip,
    );
  }

  @Post("impersonate/stop")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Arrêter l'impersonation en cours",
    description:
      "Clôt la session d'impersonation ouverte (audit). Le client restaure ensuite sa session d'origine.",
  })
  @ApiResponse({ status: 201, description: "Impersonation clôturée" })
  async stopImpersonation(@Request() req: RequestWithUser) {
    // Sous un token d'impersonation, impersonatedBy = l'acteur ; sinon userId.
    const actorId = req.user.impersonatedBy ?? req.user.userId;
    await this.authService.stopImpersonation(actorId);
    return { message: "Impersonation arrêtée" };
  }
}
