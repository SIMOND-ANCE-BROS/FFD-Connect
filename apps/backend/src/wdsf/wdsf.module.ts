import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { WdsfController } from "./wdsf.controller";
import { WdsfService } from "./wdsf.service";

@Module({
  imports: [HttpModule],
  controllers: [WdsfController],
  providers: [WdsfService],
  exports: [WdsfService],
})
export class WdsfModule {}
