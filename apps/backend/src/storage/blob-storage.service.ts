import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { Readable } from "stream";

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

  constructor(private readonly config: ConfigService) {
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
   */
  async deleteFile(blobName: string, container?: string): Promise<boolean> {
    const containerClient = this.getContainer(container);
    const blockBlob = containerClient.getBlockBlobClient(blobName);
    const response = await blockBlob.deleteIfExists();
    if (response.succeeded) {
      this.logger.log(
        `Deleted ${blobName} from ${containerClient.containerName}`,
      );
    }
    return response.succeeded;
  }
}
