import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { DisciplineCatalogQueryService } from "./discipline-catalog.query-service";
import { DisciplinesController } from "./disciplines.controller";

/** Catalog of dance domains and disciplines (ADR-0026, #1022). */
@Module({
  imports: [PrismaModule],
  controllers: [DisciplinesController],
  providers: [DisciplineCatalogQueryService],
  exports: [DisciplineCatalogQueryService],
})
export class DisciplinesModule {}
