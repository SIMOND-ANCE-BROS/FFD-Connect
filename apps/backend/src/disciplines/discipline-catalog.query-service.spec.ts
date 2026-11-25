import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import {
  danceDomainCatalogSelect,
  DISCIPLINE_CATALOG_MAX_PER_DOMAIN,
} from "../utils/prisma-selects";
import {
  DANCE_DOMAIN_CATALOG_MAX,
  DisciplineCatalogQueryService,
} from "./discipline-catalog.query-service";

describe("DisciplineCatalogQueryService (#1022)", () => {
  const findMany = jest.fn();
  let service: DisciplineCatalogQueryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        DisciplineCatalogQueryService,
        { provide: PrismaService, useValue: { danceDomain: { findMany } } },
      ],
    }).compile();
    service = module.get(DisciplineCatalogQueryService);
  });

  it("reads a bounded, ordered page with the shared select", async () => {
    findMany.mockResolvedValue([]);
    await service.getCatalog();
    expect(findMany).toHaveBeenCalledWith({
      select: danceDomainCatalogSelect,
      orderBy: [{ position: "asc" }, { code: "asc" }],
      take: DANCE_DOMAIN_CATALOG_MAX,
    });
  });

  it("only reads active disciplines, in display order and bounded", () => {
    expect(danceDomainCatalogSelect.disciplines).toEqual(
      expect.objectContaining({
        where: { active: true },
        orderBy: [{ position: "asc" }, { code: "asc" }],
        take: DISCIPLINE_CATALOG_MAX_PER_DOMAIN,
      }),
    );
  });

  it("maps domains and disciplines, filtering unknown capabilities", async () => {
    findMany.mockResolvedValue([
      {
        code: "LATINES_STANDARDS",
        label: "Latines & standards",
        capabilities: ["COUPLE", "FUTURE_CAPABILITY", "PASSPORT"],
        disciplines: [
          { code: "LATIN", label: "Danses latines", aliases: ["latin"] },
          { code: "STANDARD", label: "Danses standards", aliases: [] },
        ],
      },
      {
        code: "SALON",
        label: "Danses de salon",
        capabilities: [],
        disciplines: [],
      },
    ]);

    await expect(service.getCatalog()).resolves.toEqual({
      domains: [
        {
          code: "LATINES_STANDARDS",
          label: "Latines & standards",
          capabilities: ["COUPLE", "PASSPORT"],
          disciplines: [
            { code: "LATIN", label: "Danses latines", aliases: ["latin"] },
            { code: "STANDARD", label: "Danses standards", aliases: [] },
          ],
        },
        // A domain with no active discipline is still served (registration
        // offers every family, ADR-0026 §1).
        {
          code: "SALON",
          label: "Danses de salon",
          capabilities: [],
          disciplines: [],
        },
      ],
    });
  });

  it("serves an empty catalog when no domain exists", async () => {
    findMany.mockResolvedValue([]);
    await expect(service.getCatalog()).resolves.toEqual({ domains: [] });
  });
});
