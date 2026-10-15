import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClubsModule } from "../clubs/clubs.module";
import { PrismaModule } from "../prisma/prisma.module";
import { HelloAssoService } from "./hello-asso.service";
import { HelloAssoNotificationService } from "./helloasso-notification.service";
import { PaymentNotificationService } from "./payment-notification.service";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
import { RefundOwedAlertService } from "./refund-owed-alert.service";
import { SeatHoldService } from "./seat-hold.service";
import { SeatOccupancyController } from "./seat-occupancy.controller";
import { SeatOccupancyQueryService } from "./seat-occupancy-query.service";
import { SeatReleaseService } from "./seat-release.service";

// NotificationsService comes from the @Global() NotificationsModule.
@Module({
  imports: [PrismaModule, ConfigModule, ClubsModule],
  controllers: [PaymentController, SeatOccupancyController],
  providers: [
    HelloAssoService,
    HelloAssoNotificationService,
    PaymentNotificationService,
    PaymentService,
    RefundOwedAlertService,
    SeatHoldService,
    SeatOccupancyQueryService,
    SeatReleaseService,
  ],
  exports: [HelloAssoService, PaymentService],
})
export class PaymentModule {}
