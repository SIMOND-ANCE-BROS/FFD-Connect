import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { Readable } from "stream";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { withTimeout } from "../utils/timeout.utils";

/**
 * Borne du seul appel réseau de `deleteFile`. Plus court que le timeout du
 * disjoncteur `azure-blob` (10 s) : une suppression est une requête unitaire
 * sans corps, pas un transfert.
 */
const BLOB_DELETE_TIMEOUT_MS = 8_000;

export interface BlobFileProperties {
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

function isRestNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

@Injectable()
export class BlobStorageService {
  private readonly logger = new Logger(BlobStorageService.name);
  private readonly client: BlobServiceClient | null;
  private readonly defaultContainer: string;
  private readonly uploadsContainer: string;

  constructor(
    private readonly config: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {
    const connectionString = this.config.get<string>(
      "AZURE_STORAGE_CONNECTION_STRING",
    );
    const accountName = this.config.get<string>("AZURE_STORAGE_ACCOUNT_NAME");

    if (connectionString) {
      this.client = BlobServiceClient.fromConnectionString(connectionString);
    } else if (accountName) {
      // Use managed identity (production on Azure VM)
      this.client = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        new DefaultAzureCredential(),
      );
    } else {
      this.logger.warn(
        "No Azure Storage config found — blob storage disabled (local disk fallback)",
      );
      this.client = null;
    }

    this.defaultContainer =
      this.config.get<string>("AZURE_STORAGE_CONTAINER") ?? "tracks";
    this.uploadsContainer =
      this.config.get<string>("AZURE_STORAGE_UPLOADS_CONTAINER") ?? "uploads";
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  /** Nom du conteneur dédié aux documents uploadés (certificats de licence/médicaux). */
  getUploadsContainer(): string {
    return this.uploadsContainer;
  }

  /** Nom du conteneur par défaut (pistes audio + pochettes, à plat). */
  getDefaultContainer(): string {
    return this.defaultContainer;
  }

  private getContainer(container?: string): ContainerClient {
    if (!this.client) {
      throw new Error("Blob storage not configured");
    }
    return this.client.getContainerClient(container ?? this.defaultContainer);
  }

  async uploadFile(
    localPath: string,
    blobName: string,
    container?: string,
  ): Promise<string> {
    const containerClient = this.getContainer(container);
    const blockBlob = containerClient.getBlockBlobClient(blobName);

    this.logger.log(
      `Uploading ${blobName} to ${containerClient.containerName}`,
    );
    await blockBlob.uploadFile(localPath);

    return blockBlob.url;
  }

  async uploadBuffer(
    buffer: Buffer,
    blobName: string,
    container?: string,
  ): Promise<string> {
    const containerClient = this.getContainer(container);
    const blockBlob = containerClient.getBlockBlobClient(blobName);

    this.logger.log(
      `Uploading buffer ${blobName} (${buffer.length} bytes) to ${containerClient.containerName}`,
    );
    await blockBlob.uploadData(buffer);

    return blockBlob.url;
  }

  async downloadStream(
    blobName: string,
    container?: string,
  ): Promise<Readable> {
    const containerClient = this.getContainer(container);
    const blockBlob = containerClient.getBlockBlobClient(blobName);

    const response = await blockBlob.download(0);
    if (!response.readableStreamBody) {
      throw new Error(`Blob ${blobName} has no readable stream`);
    }

    return response.readableStreamBody as Readable;
  }

  /**
   * Métadonnées d'un blob (taille, type, ETag, date de modif), ou null s'il
   * n'existe pas. Les autres erreurs (réseau, droits) sont propagées.
   */
  async getProperties(
    blobName: string,
    container?: string,
  ): Promise<BlobFileProperties | null> {
    const containerClient = this.getContainer(container);
    const blockBlob = containerClient.getBlockBlobClient(blobName);
    try {
      const props = await blockBlob.getProperties();
      return {
        size: props.contentLength ?? 0,
        contentType: props.contentType,
        etag: props.etag,
        lastModified: props.lastModified,
      };
    } catch (error) {
      if (isRestNotFound(error)) return null;
      throw error;
    }
  }

  /** Flux d'une plage d'octets [offset, offset + count) d'un blob. */
  async downloadRange(
    blobName: string,
    offset: number,
    count: number,
    container?: string,
  ): Promise<Readable> {
    const containerClient = this.getContainer(container);
    const blockBlob = containerClient.getBlockBlobClient(blobName);

    const response = await blockBlob.download(offset, count);
    if (!response.readableStreamBody) {
      throw new Error(`Blob ${blobName} has no readable stream`);
    }
    return response.readableStreamBody as Readable;
  }

  async exists(blobName: string, container?: string): Promise<boolean> {
    const containerClient = this.getContainer(container);
    const blockBlob = containerClient.getBlockBlobClient(blobName);
    return blockBlob.exists();
  }

  /**
   * Supprime un blob s'il existe. No-op silencieux si le blob est absent.
   * Retourne true si un blob a bien été supprimé.
   *
   * Seule méthode de ce service à porter sa propre protection (circuit breaker
   * opossum `azure-blob` + `withTimeout`, convention projet / ADR-0009), parce
   * qu'elle est la primitive d'effacement partagée : l'oubli RGPD (art. 17,
   * #79) l'appelle depuis un chemin HTTP et la purge programmée (#62) la
   * réutilisera. La protéger ici évite que chaque appelant ait à la ré-emballer
   * — et à oublier de le faire. Les méthodes de lecture, elles, restent de
   * simples adaptateurs : leur seul appelant exposé (`uploads-fallback`) les
   * enveloppe déjà sur la même clé, et les emballer ici imbriquerait deux
   * disjoncteurs sur le même circuit.
   *
   * `getContainer` est appelé HORS du disjoncteur : une absence de
   * configuration est une erreur locale, pas une panne Azure, et ne doit pas
   * compter dans le taux d'échec du circuit.
   *
   * @throws ServiceUnavailableException si le circuit est ouvert, et toute
   * erreur Azure ou de timeout sinon. L'appelant décide de la dégradation.
   */
  async deleteFile(blobName: string, container?: string): Promise<boolean> {
    const containerClient = this.getContainer(container);
    const blockBlob = containerClient.getBlockBlobClient(blobName);
    const response = await this.circuitBreaker.fire("azure-blob", () =>
      withTimeout(
        blockBlob.deleteIfExists(),
        BLOB_DELETE_TIMEOUT_MS,
        `blob delete ${blobName}`,
      ),
    );
    if (response.succeeded) {
      this.logger.log(
        `Deleted ${blobName} from ${containerClient.containerName}`,
      );
    }
    return response.succeeded;
  }
}
