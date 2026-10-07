import { Test } from "@nestjs/testing";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { PrismaService } from "../prisma/prisma.service";
import { adminClubOptionSelect } from "../utils/prisma-selects";
import { AdminReferenceService } from "./admin-reference.service";

describe("AdminReferenceService", () => {
  let service: AdminReferenceService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminReferenceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AdminReferenceService);
  });

  it("exposes the backend constants", () => {
    const data = service.referenceData();
    expect(data.categories).toEqual(["Latin", "Standard", "Ten Dance"]);
    expect(data.ageGroups).toContain("Junior I");
    expect(data.ageGroups).toContain("Solo Adulte");
    expect(data.competitionLevels).toContain("Débutant");
    expect(data.passportLevels[0]).toBe("BLANC");
    expect(data.roles).toEqual(["LICENSEE", "CLUB", "STAFF", "ADMIN"]);
  });

  it("lists clubs by name with a bound", async () => {
    prisma.club.findMany.mockResolvedValue([{ id: "c1", name: "A" }] as never);
    await expect(service.clubs()).resolves.toEqual([{ id: "c1", name: "A" }]);
    expect(prisma.club.findMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
      take: 1000,
      select: adminClubOptionSelect,
    });
  });
});
