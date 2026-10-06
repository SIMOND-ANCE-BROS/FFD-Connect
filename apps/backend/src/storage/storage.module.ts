import { Global, Module } from "@nestjs/common";
import { CircuitBreakerModule } from "../common/circuit-breaker/circuit-breaker.module";
import { BlobStorageService } from "./blob-storage.service";

@Global()
@Module({
  imports: [CircuitBreakerModule],
  providers: [BlobStorageService],
  exports: [BlobStorageService],
})
export class StorageModule {}
