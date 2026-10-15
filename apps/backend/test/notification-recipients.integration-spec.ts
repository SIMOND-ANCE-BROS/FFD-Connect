import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { DevicePlatform, UserRole } from "@prisma/client";
import { notifiableAccountWhere } from "../src/auth/account-status";
import { adminRecipientsWhere } from "../src/notifications/admin-recipients";
import { PrismaService } from "../src/prisma/prisma.service";
import { idOnlySelect } from "../src/utils/prisma-selects";
import { buildServiceModule } from "./integration-app.builder";

/**
 * #301: the Prisma filters that keep notifications away from blocked
 * accounts, checked against real SQL (null `clubId`, relation filters) rather
 * than against their shape.
 */
describe("Notification recipients (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const clubIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
  });

  afterEach(async () => {
    await prisma.deviceToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    userIds.length = 0;
    clubIds.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const club = async (disabled: boolean) => {
    const c = await prisma.club.create({
      data: {
        name: `Club ${randomUUID()}`,
        disabledAt: disabled ? new Date() : null,
      },
      select: idOnlySelect,
    });
    clubIds.push(c.id);
    return c.id;
  };

  const user = async (o: {
    role: UserRole;
    extraRoles?: UserRole[];
    disabled?: boolean;
    clubId?: string;
  }) => {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Notif",
        lastName: "Recipient",
        role: o.role,
        extraRoles: o.extraRoles ?? [],
        disabledAt: o.disabled ? new Date() : null,
        ...(o.clubId && { clubId: o.clubId }),
      },
      select: idOnlySelect,
    });
    userIds.push(u.id);
    return u.id;
  };

  const matching = async (where: object) =>
    (
      await prisma.user.findMany({
        where: { AND: [{ id: { in: userIds } }, where] },
        select: idOnlySelect,
        take: userIds.length,
      })
    )
      .map((u) => u.id)
      .sort();

  it("keeps active accounts (club-less included) and drops blocked ones", async () => {
    const liveClub = await club(false);
    const deadClub = await club(true);
    const clubless = await user({ role: UserRole.LICENSEE });
    const member = await user({ role: UserRole.LICENSEE, clubId: liveClub });
    const memberOfDeadClub = await user({
      role: UserRole.LICENSEE,
      clubId: deadClub,
    });
    const clubAccount = await user({ role: UserRole.CLUB, clubId: liveClub });
    const clubAccountNoClub = await user({ role: UserRole.CLUB });
    await user({ role: UserRole.LICENSEE, disabled: true });
    await user({ role: UserRole.CLUB, clubId: deadClub });

    // A licensee of a disabled club keeps their access (rule of
    // accountBlockReason): only the CLUB main role is blocked by the club.
    expect(await matching(notifiableAccountWhere)).toEqual(
      [
        clubless,
        member,
        memberOfDeadClub,
        clubAccount,
        clubAccountNoClub,
      ].sort(),
    );
  });

  it("admin recipients exclude a disabled administrator", async () => {
    const admin = await user({ role: UserRole.ADMIN });
    const extraAdmin = await user({
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.ADMIN],
    });
    await user({ role: UserRole.ADMIN, disabled: true });
    await user({
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.ADMIN],
      disabled: true,
    });
    await user({ role: UserRole.LICENSEE });

    expect(await matching(adminRecipientsWhere())).toEqual(
      [admin, extraAdmin].sort(),
    );
  });

  it("the push device read resolves no device for a disabled account", async () => {
    const active = await user({ role: UserRole.LICENSEE });
    const disabled = await user({ role: UserRole.LICENSEE, disabled: true });
    for (const userId of [active, disabled]) {
      await prisma.deviceToken.create({
        data: { userId, token: randomUUID(), platform: DevicePlatform.IOS },
        select: idOnlySelect,
      });
    }

    const devicesOf = (userId: string) =>
      prisma.deviceToken.findMany({
        where: { userId, user: notifiableAccountWhere },
        select: idOnlySelect,
        take: 20,
      });

    expect(await devicesOf(active)).toHaveLength(1);
    expect(await devicesOf(disabled)).toHaveLength(0);
  });
});
