import { Global, Module } from "@nestjs/common";
import { CircuitBreakerModule } from "../common/circuit-breaker/circuit-breaker.module";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationPreferencesQueryService } from "./notification-preferences.query-service";
import { NotificationPreferencesService } from "./notification-preferences.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Global()
@Module({
  imports: [PrismaModule, CircuitBreakerModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationPreferencesQueryService,
    NotificationPreferencesService,
  ],
  exports: [NotificationsService, NotificationPreferencesQueryService],
})
export class NotificationsModule {}
