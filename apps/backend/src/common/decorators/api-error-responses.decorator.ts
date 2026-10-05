/**
 * Décorateur pour documenter les codes d'erreur communs dans Swagger
 */

import { applyDecorators } from "@nestjs/common";
import { ApiResponse } from "@nestjs/swagger";

/**
 * Décorateur pour ajouter les réponses d'erreur communes à un endpoint
 *
 * @example
 * ```typescript
 * @Post('example')
 * @ApiCommonErrorResponses()
 * async example() {
 *   // ...
 * }
 * ```
 */
export function ApiCommonErrorResponses() {
  return applyDecorators(
    ApiResponse({
      status: 400,
      description: "Requête invalide - Erreur de validation",
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 400 },
          message: {
            type: "array",
            items: { type: "string" },
            example: ["email must be an email", "password is required"],
          },
          error: { type: "string", example: "Bad Request" },
        },
      },
    }),
    ApiResponse({
      status: 401,
      description: "Non authentifié - Token manquant ou invalide",
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 401 },
          message: { type: "string", example: "Unauthorized" },
          error: { type: "string", example: "Unauthorized" },
        },
      },
    }),
    ApiResponse({
      status: 403,
      description: "Accès interdit - Permissions insuffisantes",
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 403 },
          message: { type: "string", example: "Forbidden resource" },
          error: { type: "string", example: "Forbidden" },
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: "Ressource non trouvée",
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 404 },
          message: { type: "string", example: "Resource not found" },
          error: { type: "string", example: "Not Found" },
        },
      },
    }),
    ApiResponse({
      status: 409,
      description: "Conflit - La ressource existe déjà",
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 409 },
          message: { type: "string", example: "Resource already exists" },
          error: { type: "string", example: "Conflict" },
        },
      },
    }),
    ApiResponse({
      status: 429,
      description: "Trop de requêtes - Rate limit dépassé",
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 429 },
          message: { type: "string", example: "Too many requests" },
          error: { type: "string", example: "Too Many Requests" },
        },
      },
    }),
    ApiResponse({
      status: 500,
      description: "Erreur serveur interne",
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 500 },
          message: { type: "string", example: "Internal server error" },
          error: { type: "string", example: "Internal Server Error" },
        },
      },
    }),
  );
}
