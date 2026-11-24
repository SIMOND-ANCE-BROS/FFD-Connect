/**
 * Dual write of a dancer's disciplines (#1023, ADR-0026 step 2), on a real
 * database: every writer of the legacy columns (sign-up, back-office
 * creation and edit) also writes `UserDiscipline` in the same transaction,
 * rows of another domain are left alone, and a rolled-back transaction
 * leaves no row behind.
 */
import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { AdminUserAccountsService } from "../src/admin/admin-user-accounts.service";
import { AdminUsersService } from "../src/admin/admin-users.service";
import { AuthService } from "../src/auth/auth.service";
import { syncUserDisciplines } from "../src/disciplines/user-disciplines.sync";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

describe("UserDiscipline dual write (#1023, integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const licenseIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: userIds } },
    });
    await prisma.license.deleteMany({ where: { id: { in: licenseIds } } });
    // UserDiscipline rows go with the user (ON DELETE CASCADE).
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    licenseIds.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const createUser = async (
    data: { role?: UserRole; category?: string | null } = {},
  ) => {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Jeanne",
        lastName: "Martin",
        ...data,
      },
      select: { id: true },
    });
    userIds.push(u.id);
    return u;
  };

  /** The user's rows as {code: [passportLevel, competitionLevel, primary]}. */
  const disciplinesOf = async (userId: string) => {
    const rows = await prisma.userDiscipline.findMany({
      where: { userId },
      select: {
        passportLevel: true,
        competitionLevel: true,
        primary: true,
        discipline: { select: { code: true } },
      },
      take: 20,
    });
    return Object.fromEntries(
      rows.map((r) => [
        r.discipline.code,
        [r.passportLevel, r.competitionLevel, r.primary],
      ]),
    );
  };

  it("sign-up mirrors the discipline of the licence", async () => {
    const license = await prisma.license.create({
      data: {
        number: `IT-${randomUUID().slice(0, 12)}`,
        validUntil: new Date(Date.now() + 365 * 86_400_000),
        category: "10 danses",
        clubName: "Club",
      },
      select: { id: true, number: true },
    });
    licenseIds.push(license.id);

    const res = await moduleRef
      .get(AuthService)
      .register(
        `${randomUUID()}@test.local`,
        "MonPass1!abc",
        license.number,
        "Martin",
        "Jeanne",
      );
    userIds.push(res.user.id);

    expect(await disciplinesOf(res.user.id)).toEqual({
      LATIN: [null, null, false],
      STANDARD: [null, null, false],
      TEN_DANCE: [null, null, true],
    });
  });

  it("back-office creation mirrors the discipline and the levels", async () => {
    const admin = await createUser({ role: UserRole.ADMIN });

    const res = await moduleRef.get(AdminUserAccountsService).create(admin.id, {
      email: `${randomUUID()}@test.local`,
      firstName: "Jeanne",
      lastName: "Martin",
      role: UserRole.LICENSEE,
      category: "Latin",
      passportLevelLatin: "VERT",
      competitionLevelLatin: "Avancé",
      competitionLevelStandard: "Débutant",
    });
    userIds.push(res.userId);

    expect(await disciplinesOf(res.userId)).toEqual({
      LATIN: ["VERT", "Avancé", true],
      STANDARD: [null, "Débutant", false],
    });
  });

  it("back-office edits keep the rows in step, other domains untouched", async () => {
    const admin = await createUser({ role: UserRole.ADMIN });
    const target = await createUser({ category: "Ten Dance" });
    const update = (dto: Parameters<AdminUsersService["update"]>[2]) =>
      moduleRef.get(AdminUsersService).update(admin.id, target.id, dto);

    // A discipline of another domain (future step) must survive the sync.
    const code = `IT_${randomUUID().slice(0, 8).toUpperCase()}`;
    const domain = await prisma.danceDomain.create({
      data: { code, label: "Test", position: 999 },
      select: { id: true },
    });
    const other = await prisma.discipline.create({
      data: { code, label: "Test", domainId: domain.id, position: 1 },
      select: { id: true },
    });
    await prisma.userDiscipline.create({
      data: { userId: target.id, disciplineId: other.id },
      select: { id: true },
    });

    try {
      await update({
        passportLevelStandard: "BLEU",
        competitionLevelLatin: "International",
      });
      expect(await disciplinesOf(target.id)).toEqual({
        LATIN: [null, "International", false],
        STANDARD: ["BLEU", null, false],
        TEN_DANCE: [null, null, true],
        [code]: [null, null, false],
      });

      // 10 danses → Standard: TEN_DANCE goes, LATIN stays for its level.
      await update({ category: "Standard" });
      expect(await disciplinesOf(target.id)).toEqual({
        LATIN: [null, "International", false],
        STANDARD: ["BLEU", null, true],
        [code]: [null, null, false],
      });

      // Legacy single level (older back-office): copied to both disciplines.
      await update({ competitionLevel: "Avancé" });
      expect(await disciplinesOf(target.id)).toMatchObject({
        LATIN: [null, "Avancé", false],
        STANDARD: ["BLEU", "Avancé", true],
      });

      // Everything cleared: only the other domain's row is left.
      await update({
        category: null,
        passportLevelStandard: null,
        competitionLevelLatin: null,
        competitionLevelStandard: null,
      });
      expect(await disciplinesOf(target.id)).toEqual({
        [code]: [null, null, false],
      });
    } finally {
      await prisma.userDiscipline.deleteMany({
        where: { disciplineId: other.id },
      });
      await prisma.discipline.delete({ where: { id: other.id } });
      await prisma.danceDomain.delete({ where: { id: domain.id } });
    }
  });

  it("writes nothing when the transaction rolls back", async () => {
    const target = await createUser();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: target.id },
          data: { category: "Latin" },
          select: { id: true },
        });
        await syncUserDisciplines(tx, target.id);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await disciplinesOf(target.id)).toEqual({});
  });
});
