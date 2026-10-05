/**
 * Utilitaires de validation des fichiers uploadés
 */

import { BadRequestException } from "@nestjs/common";

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination?: string;
  filename?: string;
  path?: string;
  buffer?: Buffer;
}

export interface FileValidationOptions {
  /** Types MIME autorisés (ex: ['image/jpeg', 'image/png']) */
  allowedMimeTypes?: readonly string[];
  /** Extensions autorisées (ex: ['.jpg', '.png', '.pdf']) */
  allowedExtensions?: readonly string[];
  /** Taille maximale en bytes (défaut: 10MB) */
  maxSize?: number;
  /** Taille minimale en bytes (défaut: 0) */
  minSize?: number;
  /** Nombre maximum de fichiers (pour les uploads multiples) */
  maxFiles?: number;
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MIN_SIZE = 0;

/**
 * Valide un fichier selon les options fournies
 *
 * @param file - Fichier à valider
 * @param options - Options de validation
 * @throws BadRequestException si la validation échoue
 *
 * @example
 * ```typescript
 * validateFile(file, {
 *   allowedMimeTypes: ['image/jpeg', 'image/png'],
 *   maxSize: 5 * 1024 * 1024, // 5MB
 * });
 * ```
 */
export function validateFile(
  file: UploadedFile | undefined,
  options: FileValidationOptions = {},
): void {
  if (!file) {
    return; // Fichier optionnel
  }

  const {
    allowedMimeTypes = [],
    allowedExtensions = [],
    maxSize = DEFAULT_MAX_SIZE,
    minSize = DEFAULT_MIN_SIZE,
  } = options;

  // Vérifier la taille
  if (file.size > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2);
    throw new BadRequestException(
      `Le fichier est trop volumineux. Taille maximale: ${maxSizeMB}MB`,
    );
  }

  if (file.size < minSize) {
    throw new BadRequestException("Le fichier est trop petit");
  }

  // Vérifier le type MIME
  if (
    allowedMimeTypes.length > 0 &&
    !allowedMimeTypes.includes(file.mimetype)
  ) {
    throw new BadRequestException(
      `Type de fichier non autorisé. Types autorisés: ${allowedMimeTypes.join(", ")}`,
    );
  }

  // Vérifier l'extension
  if (allowedExtensions.length > 0) {
    const extension = file.originalname
      .substring(file.originalname.lastIndexOf("."))
      .toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestException(
        `Extension non autorisée. Extensions autorisées: ${allowedExtensions.join(", ")}`,
      );
    }
  }
}

/**
 * File filter pour Multer qui valide les fichiers selon les options
 *
 * @param options - Options de validation
 * @returns File filter function pour Multer
 *
 * @example
 * ```typescript
 * FileInterceptor('file', {
 *   fileFilter: createFileFilter({
 *     allowedMimeTypes: ['image/jpeg', 'image/png'],
 *     maxSize: 5 * 1024 * 1024,
 *   }),
 * })
 * ```
 */
export function createFileFilter(options: FileValidationOptions = {}) {
  return (
    _req: Express.Request,
    file: UploadedFile,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ): void => {
    try {
      validateFile(file, options);
      callback(null, true);
    } catch (error) {
      callback(error as Error, false);
    }
  };
}

/**
 * Constantes pour les types de fichiers courants
 */
export const FILE_TYPES = {
  IMAGES: {
    allowedMimeTypes: [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
    maxSize: 5 * 1024 * 1024, // 5MB
  },
  PDF: {
    allowedMimeTypes: ["application/pdf"],
    allowedExtensions: [".pdf"],
    maxSize: 10 * 1024 * 1024, // 10MB
  },
  CERTIFICATES: {
    allowedMimeTypes: [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/pdf",
    ],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".pdf"],
    maxSize: 10 * 1024 * 1024, // 10MB
  },
  AUDIO: {
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg"],
    allowedExtensions: [".mp3", ".wav", ".ogg"],
    maxSize: 50 * 1024 * 1024, // 50MB
  },
} as const;
