import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import * as fs from "fs";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { StoreReviewPassthrough } from "../auth/store-review/store-review.decorator";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { getErrorMessage, getErrorStack } from "../utils/error.utils";
import { TtsRequestDto } from "./dto/tts-request.dto";
import { TtsService } from "./tts.service";

/**
 * Per-user budget of TTS requests. Competition mode preloads one clip per
 * distinct announcement (rounds × groups × dances, 3 at a time) when it
 * starts; clips already on the device are not requested again, and the
 * client waits for `Retry-After` on a 429 instead of failing.
 */
export const TTS_THROTTLE = { ttl: 60_000, limit: 60 } as const;

@ApiTags("tts")
@ApiCommonErrorResponses()
@Controller("tts")
export class TtsController {
  private readonly logger = new Logger(TtsController.name);

  constructor(private readonly ttsService: TtsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: TTS_THROTTLE })
  // Harmless write (audio cache) the app needs: the store-review account must
  // hear real announcements, not get a simulated JSON body.
  @StoreReviewPassthrough()
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Génère un fichier audio à partir d'un texte",
    description:
      "Convertit un texte (1 à 500 caractères) en fichier audio MP3 en utilisant la synthèse vocale. Authentification requise, limité à 60 requêtes par minute et par utilisateur. Le fichier est mis en cache pour éviter les régénérations.",
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
  async speak(
    @Body() body: TtsRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const filePath = await this.ttsService.getTtsAudio(body.text);
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
