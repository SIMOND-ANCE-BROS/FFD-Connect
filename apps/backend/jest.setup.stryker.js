/* global jest */

/**
 * Jest setup for Stryker — self-contained version of jest.setup.js.
 * Inlines the console setup to avoid relative path issues in .stryker-tmp sandbox.
 */

const knownTestErrors = [
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
];

if (process.env.JEST_SILENT !== "false") {
  console.log = jest.fn();
  console.warn = jest.fn();

  const originalError = console.error;
  console.error = jest.fn((...args) => {
    const message = args[0]?.toString() || "";
    if (knownTestErrors.some((pattern) => message.includes(pattern))) {
      return;
    }
    originalError(...args);
  });
}
