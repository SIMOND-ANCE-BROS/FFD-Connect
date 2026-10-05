/* global jest */

/**
 * Configuration des console.* pour les tests backend
 *
 * Par défaut, console.log et console.warn sont mockés pour réduire le bruit.
 * console.error est filtré pour ignorer les erreurs attendues dans les tests.
 *
 * Pour activer le mode verbose (voir tous les logs) :
 *   JEST_SILENT=false pnpm test
 *
 * Pour voir uniquement les vraies erreurs inattendues, garde la config par défaut.
 */
const setupConsole = require("../../packages/jest-config/setup/console");

setupConsole([
  "yt-dlp execution failed",
  "yt-dlp error",
  "Failed to initialize Firebase Admin",
  "Error sending message",
  "OCR failed",
  "api fail",
  "WDSF credentials not configured",
  "WDSF API Error",
  "init fail",
  "fail",
  "Down",
  "Invalid data",
  "Processing failed",
  "BPM Analysis Failed",
  "Download failed",
  "TTS Generation failed",
  "API Error",
]);
