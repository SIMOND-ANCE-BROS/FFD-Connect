import { StorageEngine, memoryStorage } from "multer";
import { extname } from "path";

/**
 * Storage multer en mémoire (buffer) pour les uploads destinés à Azure Blob
 * Storage : le backend tourne sans état (Container Apps), on ne persiste rien
 * sur le disque local. Le buffer est ensuite streamé vers Blob par le service.
 */
export function createMemoryUploadStorage(): StorageEngine {
  return memoryStorage();
}

/**
 * Génère un nom de blob unique pour un fichier uploadé, en conservant le motif
 * `champ-suffixeUnique.ext` (même convention que le storage disque historique).
 */
export function generateBlobName(file: {
  fieldname: string;
  originalname: string;
}): string {
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  return `${file.fieldname}-${uniqueSuffix}${extname(file.originalname)}`;
}
