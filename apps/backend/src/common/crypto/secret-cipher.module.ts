import { Module } from "@nestjs/common";
import { SecretCipherService } from "./secret-cipher.service";

/** Encryption at rest of third-party secrets (#389). ConfigModule is global. */
@Module({
  providers: [SecretCipherService],
  exports: [SecretCipherService],
})
export class SecretCipherModule {}
