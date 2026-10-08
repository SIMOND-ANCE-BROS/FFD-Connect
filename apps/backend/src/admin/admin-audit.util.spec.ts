import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { diffFields, isCreatedByAdmin } from "./admin-audit.util";

describe("diffFields", () => {
  it("keeps only the keys whose value changed", () => {
    expect(
      diffFields(
        { firstName: "A", lastName: "B", clubId: null },
        { firstName: "A", lastName: "C", clubId: "c1" },
      ),
    ).toEqual({
      before: { lastName: "B", clubId: null },
      after: { lastName: "C", clubId: "c1" },
    });
  });

  it("returns null when nothing changed", () => {
    expect(diffFields({ a: 1 }, { a: 1 })).toBeNull();
  });

  it("treats undefined in before as null", () => {
    expect(diffFields({}, { nationalRanking: 3 })).toEqual({
      before: { nationalRanking: null },
      after: { nationalRanking: 3 },
    });
  });
});

describe("isCreatedByAdmin", () => {
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
  });

  it("looks for a creation row targeting the user (lot 1 and lot 1b actions)", async () => {
    prisma.adminAuditLog.findFirst.mockResolvedValue({ id: "a1" } as never);
    await expect(isCreatedByAdmin(prisma, "u1")).resolves.toBe(true);
    expect(prisma.adminAuditLog.findFirst).toHaveBeenCalledWith({
      where: {
        targetType: "USER",
        targetId: "u1",
        action: { in: ["USER_CREATE", "CLUB_ACCOUNT_CREATE"] },
      },
      select: { id: true },
    });
  });

  it("is false without such a row (self-registered account)", async () => {
    prisma.adminAuditLog.findFirst.mockResolvedValue(null);
    await expect(isCreatedByAdmin(prisma, "u1")).resolves.toBe(false);
  });
});
