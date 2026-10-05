import { Global, Module } from "@nestjs/common";
import { CircuitBreakerModule } from "../common/circuit-breaker/circuit-breaker.module";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Global()
@Module({
  imports: [PrismaModule, CircuitBreakerModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
