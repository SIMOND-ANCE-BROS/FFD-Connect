import { Global, Module } from "@nestjs/common";
import { BlobStorageService } from "./blob-storage.service";
import { RenewalDocumentFileCleaner } from "./renewal-document-file-cleaner.service";

@Global()
@Module({
  providers: [BlobStorageService, RenewalDocumentFileCleaner],
  exports: [BlobStorageService, RenewalDocumentFileCleaner],
})
export class StorageModule {}
