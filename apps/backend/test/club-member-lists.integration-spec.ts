/**
 * Member lists of a club account (#749), on a real database: a legacy CLUB
 * account (no `clubId`) is resolved to the ONE active club its name
 * designates, then lists that club's members — never the members of a
 * homonym club (same name up to case), nor of a club whose name only matches
 * through a LIKE wildcard. An account resolving to no club lists nobody.
 */
import { TestingModule } from "@nestjs/testing";
import { RegistrationStatus, UserRole } from "@prisma/client";
import { PartnershipQueryService } from "../src/clubs/partnership-query.service";
import { CompetitionQueryService } from "../src/competitions/services/competition-query.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { UsersService } from "../src/users/users.service";
import { createFactories } from "./factories";
import { buildServiceModule } from "./integration-app.builder";

describe("Club member lists by club id (#749, integration, real DB)", () => {
  const suffix = `club-members-${Date.now()}`;
  let module: TestingModule;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  let users: UsersService;
  let partnerships: PartnershipQueryService;
  let query: CompetitionQueryService;
  // The case-insensitive unique index on Club.name (#743), when the database
  // has it: dropped while this suite creates case homonyms, then restored.
  let hadCaseIndex = false;

  const ids = {
    legacyOrganizer: "",
    homonymOrganizer: "",
    linkedMember: "",
    legacyMember: "",
    wildcardMember: "",
    homonymMember: "",
  };
  // `_` would be a LIKE wildcard if the name were compared unescaped.
  const clubName = `Club_Membres ${suffix}`;

  const idsOf = (rows: readonly { id: string }[]) =>
    rows.map((row) => row.id).sort();

  beforeAll(async () => {
    ({ module, prisma } = await buildServiceModule({ redis: true }));
    f = createFactories(prisma, suffix);
    users = module.get(UsersService);
    partnerships = module.get(PartnershipQueryService);
    query = module.get(CompetitionQueryService);

    const indexes = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'Club_name_lower_key'`;
    hadCaseIndex = Number(indexes[0]?.n ?? 0) > 0;
    await prisma.$executeRaw`DROP INDEX IF EXISTS "Club_name_lower_key"`;

    const club = await f.club({ name: clubName });
    const wildcardClub = await f.club({ name: `ClubXMembres ${suffix}` });
    const homonymA = await f.club({ name: `Homonyme ${suffix}` });
    const homonymB = await f.club({ name: `homonyme ${suffix}` });

    ids.legacyOrganizer = (
      await f.user(UserRole.CLUB, {
        clubId: null,
        clubName: ` ${clubName.toLowerCase()} `,
      })
    ).user.id;
    ids.homonymOrganizer = (
      await f.user(UserRole.CLUB, {
        clubId: null,
        clubName: `Homonyme ${suffix}`,
      })
    ).user.id;
    ids.linkedMember = (
      await f.user(UserRole.LICENSEE, { clubId: club.id, clubName })
    ).user.id;
    ids.legacyMember = (
      await f.user(UserRole.LICENSEE, { clubId: null, clubName })
    ).user.id;
    ids.wildcardMember = (
      await f.user(UserRole.LICENSEE, {
        clubId: null,
        clubName: wildcardClub.name,
      })
    ).user.id;
    // Members of both homonym clubs: the legacy account could be either.
    ids.homonymMember = (
      await f.user(UserRole.LICENSEE, {
        clubId: homonymA.id,
        clubName: homonymA.name,
      })
    ).user.id;
    await f.user(UserRole.LICENSEE, {
      clubId: homonymB.id,
      clubName: homonymB.name,
    });

    const competition = await f.competition();
    const event = await f.event(competition.id);
    for (const userId of [
      ids.linkedMember,
      ids.wildcardMember,
      ids.homonymMember,
    ]) {
      await f.registration(userId, event.id, {
        status: RegistrationStatus.PENDING,
        feePaid: false,
      });
    }
  });

  afterAll(async () => {
    await f.cleanup();
    if (hadCaseIndex) {
      await prisma.$executeRaw`
        CREATE UNIQUE INDEX IF NOT EXISTS "Club_name_lower_key" ON "Club" (lower("name"))`;
    }
    await module.close();
  });

  describe("UsersService.findClubMembers", () => {
    it("lists the resolved club's linked and legacy members only", async () => {
      const result = await users.findClubMembers(ids.legacyOrganizer, {
        skip: 0,
        take: 50,
      });

      expect(idsOf(result.data)).toEqual(
        [ids.linkedMember, ids.legacyMember].sort(),
      );
      expect(result.meta.total).toBe(2);
    });

    it("lists nobody when the name designates homonym clubs", async () => {
      const result = await users.findClubMembers(ids.homonymOrganizer, {
        skip: 0,
        take: 50,
      });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe("PartnershipQueryService.getMembersForPartnership", () => {
    it("lists the resolved club's members only", async () => {
      const members = await partnerships.getMembersForPartnership(
        ids.legacyOrganizer,
      );

      expect(idsOf(members)).toEqual(
        [ids.linkedMember, ids.legacyMember].sort(),
      );
    });

    it("lists nobody when the name designates homonym clubs", async () => {
      await expect(
        partnerships.getMembersForPartnership(ids.homonymOrganizer),
      ).resolves.toEqual([]);
    });
  });

  describe("CompetitionQueryService.getPendingRegistrationsForClub", () => {
    it("returns the resolved club's members' pending registrations only", async () => {
      const pending = await query.getPendingRegistrationsForClub(
        ids.legacyOrganizer,
      );

      expect(pending.map((registration) => registration.user.id)).toEqual([
        ids.linkedMember,
      ]);
    });

    it("returns nothing when the name designates homonym clubs", async () => {
      await expect(
        query.getPendingRegistrationsForClub(ids.homonymOrganizer),
      ).resolves.toEqual([]);
    });
  });
});
