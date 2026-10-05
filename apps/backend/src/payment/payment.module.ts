import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClubsModule } from "../clubs/clubs.module";
import { PrismaModule } from "../prisma/prisma.module";
import { HelloAssoService } from "./hello-asso.service";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";

@Module({
  imports: [PrismaModule, ConfigModule, ClubsModule],
  controllers: [PaymentController],
  providers: [HelloAssoService, PaymentService],
  exports: [HelloAssoService, PaymentService],
})
export class PaymentModule {}
