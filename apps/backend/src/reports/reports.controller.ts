import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import {
  createFileFilter,
  FILE_TYPES,
  validateFile,
} from "../utils/file-validation.util";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportsService } from "./reports.service";

@ApiTags("reports")
@ApiCommonErrorResponses()
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiOperation({
    summary: "Crée un rapport/signalement",
    description:
      "Permet de signaler un problème, bug ou suggestion avec une image optionnelle.",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["BUG", "FEATURE"],
          description: "Type de rapport",
          example: "BUG",
        },
        title: {
          type: "string",
          description: "Titre du rapport",
          example: "Erreur lors de la connexion",
        },
        description: {
          type: "string",
          description: "Description détaillée du problème",
          example:
            "L'application crash lors de la connexion avec certains comptes",
        },
        stackTrace: {
          type: "string",
          description: "Stack trace de l'erreur (optionnel, pour les bugs)",
          nullable: true,
          example:
            'Error: Cannot read property "id" of undefined\n    at LoginScreen.js:45',
        },
        image: {
          type: "string",
          format: "binary",
          description: "Image illustrant le problème (JPG, PNG, max 5MB)",
          nullable: true,
        },
      },
      required: ["type", "title", "description"],
    },
    examples: {
      bugReport: {
        summary: "Rapport de bug avec image",
        value: {
          type: "BUG",
          title: "Erreur lors de la connexion",
          description:
            "L'application crash lors de la connexion avec certains comptes",
          stackTrace: 'Error: Cannot read property "id" of undefined',
        },
      },
      featureRequest: {
        summary: "Demande de fonctionnalité",
        value: {
          type: "FEATURE",
          title: "Ajouter un mode sombre",
          description:
            "Il serait utile d'ajouter un mode sombre pour améliorer l'expérience utilisateur",
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Rapport créé avec succès",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", example: "report-123" },
        type: { type: "string", example: "BUG" },
        title: { type: "string", example: "Erreur lors de la connexion" },
        description: { type: "string" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Données invalides ou fichier image invalide",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 400 },
        message: {
          type: "string",
          example:
            "Invalid file type or size. Allowed: JPG, PNG. Max size: 5MB",
        },
        error: { type: "string", example: "Bad Request" },
      },
    },
  })
  @ApiResponse({
    status: 413,
    description: "Fichier trop volumineux - Taille maximale dépassée (5MB)",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 413 },
        message: {
          type: "string",
          example: "File too large. Maximum size is 5MB",
        },
        error: { type: "string", example: "Payload Too Large" },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: "Erreur serveur lors de la création du rapport",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 500 },
        message: {
          type: "string",
          example: "Failed to create report",
        },
        error: { type: "string", example: "Internal Server Error" },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("image", {
      fileFilter: createFileFilter(FILE_TYPES.IMAGES),
      limits: {
        fileSize: FILE_TYPES.IMAGES.maxSize,
      },
    }),
  )
  async create(
    @Body() body: CreateReportDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    // Validation supplémentaire si nécessaire
    if (file) {
      validateFile(file, FILE_TYPES.IMAGES);
    }
    return this.reportsService.create(body, file);
  }
}
