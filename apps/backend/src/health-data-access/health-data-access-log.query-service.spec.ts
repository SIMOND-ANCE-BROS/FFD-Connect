import { PrismaService } from "../prisma/prisma.service";
import { healthDataAccessLogSelect } from "../utils/prisma-selects";
import { HealthDataAccessLogQueryService } from "./health-data-access-log.query-service";

describe("HealthDataAccessLogQueryService", () => {
  const prisma = {
    healthDataAccessLog: { count: jest.fn(), findMany: jest.fn() },
  };
  const service = new HealthDataAccessLogQueryService(
    prisma as unknown as PrismaService,
  );
  const row = {
    id: "log-1",
    subjectUserId: "user-1",
    actorUserId: "admin-1",
    actorRole: "ADMIN",
    action: "DOWNLOAD",
    resourceType: "MEDICAL_CERTIFICATE",
    resourceId: "doc-1",
    route: "GET /admin/license-renewals/:id/documents/:docId/file",
    createdAt: new Date("2027-01-01T00:00:00.000Z"),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.healthDataAccessLog.count.mockResolvedValue(1);
    prisma.healthDataAccessLog.findMany.mockResolvedValue([row]);
  });

  it("lists newest first, bounded, ids only", async () => {
    const page = await service.list({});

    expect(prisma.healthDataAccessLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 20,
      select: healthDataAccessLogSelect,
    });
    expect(page).toEqual({
      data: [row],
      meta: { total: 1, skip: 0, take: 20, hasMore: false },
    });
  });

  it("filters by subject, actor and action", async () => {
    await service.list({
      subjectUserId: "user-1",
      actorUserId: "admin-1",
      action: "DOWNLOAD",
      skip: 10,
      take: 5,
    });

    const where = {
      subjectUserId: "user-1",
      actorUserId: "admin-1",
      action: "DOWNLOAD",
    };
    expect(prisma.healthDataAccessLog.count).toHaveBeenCalledWith({ where });
    expect(prisma.healthDataAccessLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 10, take: 5 }),
    );
  });

  it("the select joins no name nor e-mail", () => {
    expect(Object.keys(healthDataAccessLogSelect)).not.toEqual(
      expect.arrayContaining(["actor", "subject", "email", "firstName"]),
    );
  });
});
