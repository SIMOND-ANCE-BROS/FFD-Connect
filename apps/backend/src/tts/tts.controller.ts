import {
  Controller,
  Post,
  Body,
  Res,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger";
import { TtsService } from "./tts.service";
import type { Response } from "express";
import * as fs from "fs";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { getErrorMessage, getErrorStack } from "../utils/error.utils";

@ApiTags("tts")
@ApiCommonErrorResponses()
@Controller("tts")
export class TtsController {
  private readonly logger = new Logger(TtsController.name);

  constructor(private readonly ttsService: TtsService) {}

  @Post()
  @ApiOperation({
    summary: "Génère un fichier audio à partir d'un texte",
    description:
      "Convertit un texte en fichier audio MP3 en utilisant la synthèse vocale. Le fichier est mis en cache pour éviter les régénérations.",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Texte à convertir en audio",
          example: "Bienvenue sur FFD Connect",
          minLength: 1,
          maxLength: 500,
        },
      },
      required: ["text"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Fichier audio généré avec succès",
    content: {
      "audio/mpeg": {
        schema: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Texte manquant ou invalide",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 400 },
        message: { type: "string", example: "Text is required" },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: "Erreur lors de la génération audio",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 500 },
        message: {
          type: "string",
          example: "TTS Generation failed: [error details]",
        },
      },
    },
  })
  async speak(@Body("text") text: string, @Res() res: Response) {
    if (!text) {
      throw new HttpException("Text is required", HttpStatus.BAD_REQUEST);
    }

    try {
      const filePath = await this.ttsService.getTtsAudio(text);
      res.setHeader("Content-Type", "audio/mpeg");
      fs.createReadStream(filePath).pipe(res);
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const errorStack = getErrorStack(error);
      this.logger.error("TTS generation failed", errorStack);
      throw new HttpException(
        `TTS Generation failed: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
