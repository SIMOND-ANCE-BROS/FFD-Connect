import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CareerController } from "./career.controller";
import { CareerQueryService } from "./career-query.service";
import { CareerService } from "./career.service";

@Module({
  imports: [PrismaModule],
  controllers: [CareerController],
  providers: [CareerService, CareerQueryService],
  exports: [CareerService, CareerQueryService],
})
export class CareerModule {}
