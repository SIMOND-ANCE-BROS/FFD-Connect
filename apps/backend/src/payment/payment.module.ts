import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClubsModule } from "../clubs/clubs.module";
import { PrismaModule } from "../prisma/prisma.module";
import { HelloAssoService } from "./hello-asso.service";
import { HelloAssoNotificationService } from "./helloasso-notification.service";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
import { RefundOwedAlertService } from "./refund-owed-alert.service";
import { SeatHoldService } from "./seat-hold.service";
import { SeatReleaseService } from "./seat-release.service";

@Module({
  imports: [PrismaModule, ConfigModule, ClubsModule],
  controllers: [PaymentController],
  providers: [
    HelloAssoService,
    HelloAssoNotificationService,
    PaymentService,
    RefundOwedAlertService,
    SeatHoldService,
    SeatReleaseService,
  ],
  exports: [HelloAssoService, PaymentService],
})
export class PaymentModule {}
