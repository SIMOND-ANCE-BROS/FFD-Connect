import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClubsModule } from "../clubs/clubs.module";
import { PrismaModule } from "../prisma/prisma.module";
import { HelloAssoService } from "./hello-asso.service";
import { HelloAssoNotificationService } from "./helloasso-notification.service";
import { PaymentNotificationService } from "./payment-notification.service";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
import { SeatReleaseService } from "./seat-release.service";

// NotificationsService comes from the @Global() NotificationsModule.
@Module({
  imports: [PrismaModule, ConfigModule, ClubsModule],
  controllers: [PaymentController],
  providers: [
    HelloAssoService,
    HelloAssoNotificationService,
    PaymentNotificationService,
    PaymentService,
    SeatReleaseService,
  ],
  exports: [HelloAssoService, PaymentService],
})
export class PaymentModule {}
