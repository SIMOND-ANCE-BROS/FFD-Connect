import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { danceDomainCatalogSelect } from "../utils/prisma-selects";
import { knownCapabilities } from "./dance-capabilities";
import type { DisciplineCatalogDto } from "./dto/discipline-catalog.dto";

/**
 * Upper bound of the domains read (#1022). The federation publishes 12
 * families (ADR-0026); the bound only keeps the read finite.
 */
export const DANCE_DOMAIN_CATALOG_MAX = 50;

/** Reads the catalog of dance domains and disciplines (ADR-0026, #1022). */
@Injectable()
export class DisciplineCatalogQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getCatalog(): Promise<DisciplineCatalogDto> {
    const domains = await this.prisma.danceDomain.findMany({
      select: danceDomainCatalogSelect,
      orderBy: [{ position: "asc" }, { code: "asc" }],
      take: DANCE_DOMAIN_CATALOG_MAX,
    });
    return {
      domains: domains.map((domain) => ({
        code: domain.code,
        label: domain.label,
        capabilities: knownCapabilities(domain.capabilities),
        disciplines: domain.disciplines.map((discipline) => ({
          code: discipline.code,
          label: discipline.label,
          aliases: discipline.aliases,
        })),
      })),
    };
  }
}
