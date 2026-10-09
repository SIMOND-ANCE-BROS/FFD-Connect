import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";
import { UpdateWdsfDto } from "./dto/update-wdsf.dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiCommonErrorResponses()
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("members")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Récupère les membres du club de l'organisateur",
    description:
      "Retourne la liste des membres du club associé à l'utilisateur organisateur authentifié. Nécessite le rôle ORGANIZER.",
  })
  @ApiResponse({
    status: 200,
    description: "Liste des membres du club récupérée avec succès",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          licenseNumber: { type: "string", nullable: true },
          role: {
            type: "string",
            enum: ["LICENSEE", "CLUB", "STAFF", "ADMIN"],
          },
          roles: {
            type: "array",
            items: {
              type: "string",
              enum: ["LICENSEE", "CLUB", "STAFF", "ADMIN"],
            },
            description:
              "Rôle principal + rôles supplémentaires (multi-profil)",
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Non autorisé - Token JWT invalide ou expiré",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 401 },
        message: { type: "string", example: "Unauthorized" },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Permissions insuffisantes - Rôle ORGANIZER requis",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 403 },
        message: { type: "string", example: "Forbidden" },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "Organisateur ou club non trouvé",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 404 },
        message: { type: "string", example: "Club not found" },
      },
    },
  })
  getMembers(
    @Request() req: RequestWithUser,
    @Query() pagination: PaginationParamsDto,
  ) {
    // req.user is populated by JwtStrategy -> { userId, email, role }
    return this.usersService.findClubMembers(req.user.userId, pagination);
  }

  @Get("search")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Recherche d'utilisateurs (impersonation)",
    description:
      "Réservé ADMIN/STAFF. Recherche par email, prénom, nom ou numéro de licence (min. 2 caractères). Résultat borné, sans secret. Sert au sélecteur de cible d'impersonation (#545).",
  })
  @ApiResponse({ status: 200, description: "Utilisateurs correspondants" })
  @ApiResponse({ status: 403, description: "Non autorisé" })
  searchUsers(@Query("q") q?: string) {
    return this.usersService.searchUsers(q ?? "");
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Récupère le profil de l'utilisateur connecté",
    description:
      "Retourne les informations complètes du profil de l'utilisateur authentifié, incluant les détails personnels, le rôle et les associations.",
  })
  @ApiResponse({
    status: 200,
    description: "Profil utilisateur récupéré avec succès",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", example: "user-123" },
        email: { type: "string", example: "user@example.com" },
        firstName: { type: "string", example: "John" },
        lastName: { type: "string", example: "Doe" },
        role: {
          type: "string",
          enum: ["LICENSEE", "CLUB", "STAFF", "ADMIN"],
          example: "LICENSEE",
        },
        clubName: {
          type: "string",
          nullable: true,
          example: "Club de Danse Paris",
        },
        category: {
          type: "string",
          nullable: true,
          enum: ["Latin", "Standard", "Ten Dance"],
          description: "Discipline déclarée (valeur stockée, non traduite)",
        },
        ageGroup: { type: "string", nullable: true },
        competitionLevelLatin: {
          type: "string",
          nullable: true,
          enum: ["Débutant", "Intermédiaire", "Avancé", "International"],
          description: "Niveau de compétition en Latines",
        },
        competitionLevelStandard: {
          type: "string",
          nullable: true,
          enum: ["Débutant", "Intermédiaire", "Avancé", "International"],
          description: "Niveau de compétition en Standards",
        },
        competitionLevel: {
          type: "string",
          nullable: true,
          deprecated: true,
          description:
            "Ancien niveau unique, conservé pour les anciennes versions de l'app. Préférer les niveaux par discipline.",
        },
        licenseNumber: { type: "string", nullable: true },
        license: {
          type: "object",
          nullable: true,
          properties: {
            id: { type: "string" },
            number: { type: "string", example: "FFD-123456" },
            validUntil: { type: "string", format: "date-time" },
            category: { type: "string" },
            clubName: { type: "string" },
            qrCodeSignature: { type: "string", nullable: true },
            qrCode: {
              type: "string",
              nullable: true,
              description:
                "Contenu du QR de licence signé par le serveur, à afficher tel quel. Null si la signature est désactivée.",
            },
            appleWalletAvailable: {
              type: "boolean",
              description:
                "Vrai si le serveur peut produire le pass Apple Wallet : l'app n'affiche le bouton « Ajouter à Apple Wallet » que dans ce cas.",
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        wdsf: {
          type: "object",
          nullable: true,
          description: "Licence WDSF liée au compte (null si aucune).",
          properties: {
            min: { type: "string", example: "10117265" },
            nationality: { type: "string", nullable: true },
            licenseType: { type: "string", nullable: true },
            ageGroup: { type: "string", nullable: true },
            expiresOn: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            federation: {
              type: "string",
              nullable: true,
              example: "FFD - Fédération Française de Danse",
              description:
                "Fédération nationale du titulaire (jamais « WDSF »). Null si inconnue.",
            },
          },
        },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Non autorisé - Token JWT invalide ou expiré",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 401 },
        message: { type: "string", example: "Unauthorized" },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "Utilisateur non trouvé",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 404 },
        message: { type: "string", example: "User not found" },
      },
    },
  })
  getProfile(@Request() req: RequestWithUser) {
    return this.usersService.findOne(req.user.userId);
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Met à jour le profil (ex. licence WDSF)",
    description:
      "Permet de lier ou dissocier la licence WDSF (données envoyées après vérification GET /wdsf/athlete/:min). Envoyer wdsf: null pour supprimer le lien.",
  })
  @ApiBody({ type: UpdateWdsfDto })
  @ApiResponse({
    status: 200,
    description: "Profil mis à jour",
  })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  @ApiResponse({ status: 404, description: "Utilisateur non trouvé" })
  updateProfile(
    @Request() req: RequestWithUser,
    @Body() payload: UpdateWdsfDto,
  ) {
    return this.usersService.updateWdsf(req.user.userId, payload.wdsf ?? null);
  }

  @Get("me/export")
  @UseGuards(JwtAuthGuard, NoImpersonationGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Export RGPD des données personnelles (portabilité)",
    description:
      "Retourne toutes les données personnelles de l'utilisateur connecté (profil, licence, inscriptions, partenariats, notifications) en un seul JSON — droit à la portabilité, RGPD art. 20. Ne contient jamais de secrets ni de données de tiers.",
  })
  @ApiResponse({
    status: 200,
    description: "Export JSON des données personnelles",
  })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  exportMyData(@Request() req: RequestWithUser) {
    return this.usersService.exportMyData(req.user.userId);
  }

  @Delete("me")
  @UseGuards(JwtAuthGuard, NoImpersonationGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Suppression définitive du compte (droit à l'oubli)",
    description:
      "Supprime le compte et toutes les données personnelles associées — RGPD art. 17 et exigence Apple 5.1.1(v). Le mot de passe courant est exigé en confirmation. Irréversible : la licence fédérale est simplement détachée (elle reste propriété de la FFD).",
  })
  @ApiBody({ type: DeleteAccountDto })
  @ApiResponse({ status: 200, description: "Compte supprimé" })
  @ApiResponse({ status: 401, description: "Mot de passe incorrect" })
  async deleteMyAccount(
    @Request() req: RequestWithUser,
    @Body() payload: DeleteAccountDto,
  ) {
    await this.usersService.deleteMyAccount(req.user.userId, payload.password);
    return { message: "Compte supprimé" };
  }
}
