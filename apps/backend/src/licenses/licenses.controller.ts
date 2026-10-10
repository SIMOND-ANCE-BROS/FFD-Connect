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
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
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
        category: { type: "string", example: "Standard" },
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

  @Post("renew")
  @ApiOperation({
    summary: "Renouvelle la licence de l'utilisateur",
    description:
      "Traite un certificat de licence (image) via OCR pour extraire les informations et renouvelle ou crée la licence. La licence est valide jusqu'au 31 août (Europe/Paris) qui termine la saison en cours, ou celle de la saison suivante si le renouvellement a lieu entre le 1er juillet et le 31 août ; une date de fin déjà plus lointaine est conservée.",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        certificate: {
          type: "string",
          format: "binary",
          description:
            "Fichier image du certificat de licence (JPG, PNG, max 5MB)",
        },
      },
      required: ["certificate"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Licence renouvelée avec succès",
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
        category: { type: "string", example: "Standard" },
        clubName: { type: "string", example: "Vienne Handi Danse" },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Erreur de validation - Certificat manquant, format invalide ou OCR échoué",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 400 },
        message: {
          type: "string",
          example:
            "Impossible de valider le certificat : numéro de licence non détecté",
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Non autorisé - Token JWT manquant ou invalide",
  })
  @ApiResponse({
    status: 404,
    description: "Utilisateur non trouvé",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 404 },
        message: { type: "string", example: "Utilisateur non trouvé" },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("certificate", {
      storage: createMemoryUploadStorage(),
      fileFilter: createFileFilter(FILE_TYPES.CERTIFICATES),
      limits: {
        fileSize: FILE_TYPES.CERTIFICATES.maxSize,
      },
    }),
  )
  async renewLicense(
    @Req() req: RequestWithUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    // Validation supplémentaire
    if (!file?.buffer) {
      throw new BadRequestException("Certificat requis");
    }
    validateFile(file, FILE_TYPES.CERTIFICATES);
    // Le certificat n'est utilisé que pour l'OCR (jamais persisté), on passe
    // directement le buffer mémoire au service.
    return this.licensesService.renewLicense(req.user.userId, file.buffer);
  }

  // --- Demande de renouvellement (workflow documents + OCR) ---

  @StoreReviewSimulation(simulatedRenewalStart)
  @Post("renewal/start")
  @ApiOperation({
    summary: "Démarrer une demande de renouvellement",
    description:
      "Crée ou récupère une demande de renouvellement en brouillon pour déposer le certificat médical et le certificat de licence.",
  })
  @ApiResponse({ status: 200, description: "Demande créée ou existante" })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  async startRenewal(@Req() req: RequestWithUser) {
    return this.licenseRenewalService.startRenewalRequest(req.user.userId);
  }

  @StoreReviewOwnData()
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
  @Post("renewal/:id/documents")
  @ApiOperation({
    summary: "Déposer un document sur une demande (OCR automatique)",
    description:
      "Upload d’un certificat médical ou d’un certificat de licence. L’OCR extrait les infos (apte, date, numéro de licence, etc.).",
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
    status: 200,
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
    return this.licenseRenewalService.uploadRenewalDocument(
      req.user.userId,
      id,
      docType,
      file.buffer,
      generateBlobName(file),
    );
  }

  @StoreReviewSimulation(simulatedRenewalSubmit)
  @Post("renewal/:id/submit")
  @ApiOperation({
    summary: "Soumettre la demande de renouvellement",
    description:
      "Passe la demande en attente de validation. Requiert certificat médical et certificat de licence.",
  })
  @ApiParam({ name: "id", description: "ID de la demande" })
  @ApiResponse({ status: 200, description: "Demande soumise" })
  @ApiResponse({
    status: 400,
    description: "Documents manquants ou déjà soumise",
  })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  @ApiResponse({ status: 404, description: "Demande non trouvée" })
  async submitRenewal(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.licenseRenewalService.submitRenewalRequest(req.user.userId, id);
  }
}
