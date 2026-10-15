import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request as Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { LicenseRenewalDocumentType } from "@prisma/client";
import { Request as ExpressRequest } from "express";
import {
  ApiCommonErrorResponses,
  CONFLICT_ERROR_SCHEMA,
} from "../common/decorators/api-error-responses.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  createFileFilter,
  FILE_TYPES,
  validateFile,
} from "../utils/file-validation.util";
import {
  createMemoryUploadStorage,
  generateBlobName,
} from "../utils/upload-storage.util";
import { HEALTH_DATA_ACCESS_ROUTES } from "../health-data-access/dto/health-data-access-log.dto";
import { ImpersonatedRenewalAccessInterceptor } from "./impersonated-renewal-access.interceptor";
import { LicenseRenewalService } from "./license-renewal.service";
import { LicensesService } from "./licenses.service";
import {
  StoreReviewOwnData,
  StoreReviewSimulation,
} from "../auth/store-review/store-review.decorator";
import {
  simulatedRenewalDocument,
  simulatedRenewalStart,
  simulatedRenewalSubmit,
} from "../auth/store-review/store-review-responses";

interface RequestWithUser extends ExpressRequest {
  user: {
    userId: string;
    email: string;
    /** Set during a "log in as" session (#545). */
    impersonatedBy?: string;
  };
}

@ApiTags("licenses")
@ApiCommonErrorResponses()
@Controller("licenses")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class LicensesController {
  constructor(
    private readonly licensesService: LicensesService,
    private readonly licenseRenewalService: LicenseRenewalService,
  ) {}

  @StoreReviewOwnData()
  @Get("my")
  @ApiOperation({
    summary: "Récupère la licence de l'utilisateur connecté",
    description:
      "Retourne les informations de la licence de l'utilisateur authentifié, incluant le numéro, la date de validité, la catégorie et le club.",
  })
  @ApiResponse({
    status: 200,
    description: "Licence récupérée avec succès",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", example: "license-123" },
        userId: { type: "string", example: "user-456" },
        number: { type: "string", example: "FFD-123456" },
        validUntil: {
          type: "string",
          format: "date-time",
          example: "2026-08-31T23:59:59.000Z",
        },
        category: {
          type: "string",
          example: "Standard",
          description:
            "Catégorie enregistrée sur la licence (valeur brute, peut ne pas refléter le profil). Préférer `discipline` pour l'affichage.",
        },
        discipline: {
          type: "string",
          nullable: true,
          enum: ["Latin", "Standard", "Ten Dance"],
          example: "Latin",
          description:
            "Discipline(s) réellement pratiquée(s), déduite(s) du profil du titulaire (discipline déclarée, niveaux par discipline) puis de la licence : « Ten Dance » seulement si Latines ET Standards. Même valeur que le pass Apple Wallet. Null si inconnue.",
        },
        clubName: { type: "string", example: "Vienne Handi Danse" },
        qrCodeSignature: { type: "string", nullable: true },
        qrCode: {
          type: "string",
          nullable: true,
          description:
            "Contenu du QR de licence signé par le serveur, à afficher tel quel (valable jusqu'à la fin de validité de la licence). Null si la signature est désactivée.",
          example: '{"v":1,"id":"FFD-123456","exp":"2026-08-31","sig":"…"}',
        },
        appleWalletAvailable: {
          type: "boolean",
          description:
            "Vrai si le serveur peut produire le pass Apple Wallet (pass configuré et QR signés) : l'app n'affiche le bouton « Ajouter à Apple Wallet » que dans ce cas.",
          example: true,
        },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Non autorisé - Token JWT manquant ou invalide",
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
    description: "Licence non trouvée pour cet utilisateur",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 404 },
        message: { type: "string", example: "License non trouvée" },
      },
    },
  })
  async getMyLicense(@Req() req: RequestWithUser) {
    return this.licensesService.getLicense(req.user.userId);
  }

  /*
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a new license file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadLicense(
    @Req() req: RequestWithUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    return this.licensesService.create(req.user.userId, file);
  }
  */

  // --- Demande de renouvellement (workflow documents + OCR) ---
  // Each response carries the medical certificate's OCR hints: read during an
  // impersonation, it is traced as a health-data access (#63).

  @StoreReviewSimulation(simulatedRenewalStart)
  @UseInterceptors(ImpersonatedRenewalAccessInterceptor)
  @Post("renewal/start")
  @ApiOperation({
    summary: "Démarrer une demande de renouvellement",
    description:
      "Crée ou récupère une demande de renouvellement en brouillon pour déposer le certificat médical et le certificat de licence. Si une demande est déjà en attente de validation (PENDING), c'est elle qui est renvoyée : une seule demande en attente par utilisateur.",
  })
  @ApiResponse({ status: 201, description: "Demande créée ou existante" })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  async startRenewal(@Req() req: RequestWithUser) {
    return this.licenseRenewalService.startRenewalRequest(req.user.userId);
  }

  @StoreReviewOwnData()
  @UseInterceptors(ImpersonatedRenewalAccessInterceptor)
  @Get("renewal/my")
  @ApiOperation({
    summary: "Ma demande de renouvellement en cours",
    description:
      "Retourne la dernière demande de renouvellement de l'utilisateur (brouillon ou soumise).",
  })
  @ApiResponse({ status: 200, description: "Demande ou null" })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  async getMyRenewal(@Req() req: RequestWithUser) {
    return this.licenseRenewalService.getMyRenewalRequest(req.user.userId);
  }

  @StoreReviewSimulation(simulatedRenewalDocument)
  @UseInterceptors(ImpersonatedRenewalAccessInterceptor)
  @Post("renewal/:id/documents")
  @ApiOperation({
    summary: "Déposer un document sur une demande (OCR automatique)",
    description:
      "Upload d’un certificat médical ou d’un certificat de licence. L’OCR extrait les infos (apte, date, numéro de licence, etc.) à titre d’indices pour l’administrateur : elles ne refusent jamais le document.",
  })
  @ApiParam({ name: "id", description: "ID de la demande de renouvellement" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["type", "document"],
      properties: {
        type: {
          type: "string",
          enum: ["MEDICAL_CERTIFICATE", "LICENSE_CERTIFICATE"],
          description: "Type de document",
        },
        document: { type: "string", format: "binary" },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Demande mise à jour avec document et données OCR",
  })
  @ApiResponse({
    status: 400,
    description: "Type invalide ou fichier manquant",
  })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  @ApiResponse({ status: 404, description: "Demande non trouvée" })
  @UseInterceptors(
    FileInterceptor("document", {
      storage: createMemoryUploadStorage(),
      fileFilter: createFileFilter(FILE_TYPES.CERTIFICATES),
      limits: { fileSize: FILE_TYPES.CERTIFICATES.maxSize },
    }),
  )
  async uploadRenewalDocument(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body("type") type: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer) throw new BadRequestException("Document requis");
    validateFile(file, FILE_TYPES.CERTIFICATES);
    const docType =
      type === "MEDICAL_CERTIFICATE"
        ? LicenseRenewalDocumentType.MEDICAL_CERTIFICATE
        : type === "LICENSE_CERTIFICATE"
          ? LicenseRenewalDocumentType.LICENSE_CERTIFICATE
          : null;
    if (!docType)
      throw new BadRequestException(
        "type doit être MEDICAL_CERTIFICATE ou LICENSE_CERTIFICATE",
      );
    const impersonator = req.user.impersonatedBy;
    return this.licenseRenewalService.uploadRenewalDocument(
      req.user.userId,
      id,
      docType,
      file.buffer,
      generateBlobName(file),
      // A replaced medical certificate is deleted: journaled under whoever
      // actually acts (#63).
      {
        actorUserId: impersonator ?? req.user.userId,
        actorRole: impersonator ? "IMPERSONATOR" : "OWNER",
        route: HEALTH_DATA_ACCESS_ROUTES.renewalDocumentUpload,
      },
    );
  }

  @StoreReviewSimulation(simulatedRenewalSubmit)
  @UseInterceptors(ImpersonatedRenewalAccessInterceptor)
  @Post("renewal/:id/submit")
  @ApiOperation({
    summary: "Soumettre la demande de renouvellement",
    description:
      "Passe la demande en attente de validation (PENDING) : elle attend la décision d'un administrateur, aucune licence n'est créée ni prolongée à la soumission. Requiert certificat médical et certificat de licence ; les lectures OCR ne bloquent pas l'envoi. Refusée (409) si une autre demande de l'utilisateur est déjà en attente de validation.",
  })
  @ApiParam({ name: "id", description: "ID de la demande" })
  @ApiResponse({ status: 201, description: "Demande soumise" })
  @ApiResponse({
    status: 400,
    description: "Documents manquants ou déjà soumise",
  })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  @ApiResponse({ status: 404, description: "Demande non trouvée" })
  // Replaces the common 409 description: same body schema, both causes.
  @ApiResponse({
    status: 409,
    description:
      "Conflit - Une autre demande de l'utilisateur est déjà en attente de validation",
    schema: CONFLICT_ERROR_SCHEMA,
  })
  async submitRenewal(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.licenseRenewalService.submitRenewalRequest(req.user.userId, id);
  }
}
