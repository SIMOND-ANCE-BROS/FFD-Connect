import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClubsModule } from "../clubs/clubs.module";
import { PrismaModule } from "../prisma/prisma.module";
import { HelloAssoService } from "./hello-asso.service";
import { PaymentNotificationService } from "./payment-notification.service";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";

// NotificationsService comes from the @Global() NotificationsModule.
@Module({
  imports: [PrismaModule, ConfigModule, ClubsModule],
  controllers: [PaymentController],
  providers: [HelloAssoService, PaymentService, PaymentNotificationService],
  exports: [HelloAssoService, PaymentService],
})
export class PaymentModule {}
