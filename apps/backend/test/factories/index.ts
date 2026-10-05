/**
 * Test factories for integration tests.
 *
 * Usage:
 *   const suffix = `my-suite-${Date.now()}`;
 *   const f = createFactories(prisma, jwtService, suffix);
 *
 *   const { user, token } = await f.user();
 *   const comp = await f.competition();
 *   const event = await f.event(comp.id);
 *   await f.registration({ userId: user.id, eventId: event.id });
 *
 * Cleanup (respects FK order):
 *   await f.cleanup();
 */

import { JwtService } from "@nestjs/jwt";
import {
  CompetitionStatus,
  EventType,
  PartnershipStatus,
  RegistrationStatus,
  UserRole,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../src/prisma/prisma.service";

// ─── Partial overrides helpers ────────────────────────────────────────────────

type Override<T> = Partial<Record<keyof T, unknown>>;

// ─── Factory output types ─────────────────────────────────────────────────────

export interface TestUser {
  user: { id: string; email: string; role: UserRole };
  token: string;
  email: string;
  password: string;
}

// ─── Main factory ─────────────────────────────────────────────────────────────

export function createFactories(
  prisma: PrismaService,
  suffix: string,
  jwtService?: JwtService,
) {
  let _userCounter = 0;

  // ── User ──────────────────────────────────────────────────────────────────

  async function user(
    role = UserRole.LICENSEE,
    overrides: Override<Parameters<typeof prisma.user.create>[0]["data"]> = {},
  ): Promise<TestUser> {
    const n = ++_userCounter;
    const email = `user-${n}-${Math.random().toString(36).slice(2)}@integ-${suffix}.test`;
    const password = "Password123!";
    const hashed = await bcrypt.hash(password, 10);

    const created = await prisma.user.create({
      data: {
        email,
        password: hashed,
        firstName: "Test",
        lastName: `User${n}`,
        role,
        ...(overrides as object),
      },
    });

    const token = jwtService
      ? jwtService.sign({
          sub: created.id,
          email: created.email,
          role: created.role,
        })
      : "";

    return { user: created, token, email, password };
  }

  // ── Club ──────────────────────────────────────────────────────────────────

  async function club(
    overrides: Override<Parameters<typeof prisma.club.create>[0]["data"]> = {},
  ) {
    return prisma.club.create({
      data: {
        name: `Test Club ${suffix}`,
        ...(overrides as object),
      },
    });
  }

  // ── Competition ───────────────────────────────────────────────────────────

  async function competition(
    overrides: Override<
      Parameters<typeof prisma.competition.create>[0]["data"]
    > = {},
  ) {
    return prisma.competition.create({
      data: {
        title: `Compétition ${suffix}`,
        date: new Date("2026-06-01"),
        location: "Paris",
        status: CompetitionStatus.UPCOMING,
        ...(overrides as object),
      },
    });
  }

  // ── Event ─────────────────────────────────────────────────────────────────

  async function event(
    competitionId: string,
    overrides: Override<Parameters<typeof prisma.event.create>[0]["data"]> = {},
  ) {
    return prisma.event.create({
      data: {
        competitionId,
        category: "Latin",
        ageGroup: "Adulte",
        eventType: EventType.COUPLE,
        ...(overrides as object),
      },
    });
  }

  // ── Registration ──────────────────────────────────────────────────────────

  async function registration(
    userId: string,
    eventId: string,
    overrides: Override<
      Parameters<typeof prisma.registration.create>[0]["data"]
    > = {},
  ) {
    return prisma.registration.create({
      data: {
        userId,
        eventId,
        status: RegistrationStatus.CONFIRMED,
        feePaid: true,
        checkedIn: false,
        ...(overrides as object),
      },
    });
  }

  // ── License ───────────────────────────────────────────────────────────────

  async function license(
    userId: string,
    overrides: Override<
      Parameters<typeof prisma.license.create>[0]["data"]
    > = {},
  ) {
    return prisma.license.create({
      data: {
        userId,
        number: `LIC-${suffix}-${Math.random().toString(36).slice(2)}`,
        category: "Latin",
        validUntil: new Date("2027-08-31"),
        clubName: "Test Club",
        ...(overrides as object),
      },
    });
  }

  // ── Partnership ───────────────────────────────────────────────────────────

  async function partnership(
    clubId: string,
    user1Id: string,
    user2Id: string,
    overrides: Override<
      Parameters<typeof prisma.partnership.create>[0]["data"]
    > = {},
  ) {
    return prisma.partnership.create({
      data: {
        clubId,
        user1Id,
        user2Id,
        status: PartnershipStatus.ACTIVE,
        startDate: new Date("2024-01-01"),
        ...(overrides as object),
      },
    });
  }

  // ── Result ────────────────────────────────────────────────────────────────

  async function result(
    eventId: string,
    userId: string,
    overrides: Override<
      Parameters<typeof prisma.result.create>[0]["data"]
    > = {},
  ) {
    return prisma.result.create({
      data: {
        eventId,
        userId,
        ranking: 1,
        round: "Finale",
        ...(overrides as object),
      },
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  // Deletes all test data created by this factory, in FK-safe order.

  async function cleanup() {
    const emailPattern = `@integ-${suffix}.test`;
    const userWhere = { email: { contains: emailPattern } };

    const silentDelete = (p: Promise<unknown>) => p.catch(() => {});

    await silentDelete(
      prisma.result.deleteMany({
        where: { event: { competition: { title: { contains: suffix } } } },
      }),
    );
    await silentDelete(
      prisma.registration.deleteMany({
        where: {
          OR: [
            { user: userWhere },
            { event: { competition: { title: { contains: suffix } } } },
          ],
        },
      }),
    );
    await silentDelete(
      prisma.partnership.deleteMany({
        where: { OR: [{ user1: userWhere }, { user2: userWhere }] },
      }),
    );
    await silentDelete(
      prisma.event.deleteMany({
        where: { competition: { title: { contains: suffix } } },
      }),
    );
    await silentDelete(
      prisma.competition.deleteMany({ where: { title: { contains: suffix } } }),
    );
    await silentDelete(
      prisma.license.deleteMany({ where: { user: userWhere } }),
    );
    await silentDelete(
      prisma.refreshToken.deleteMany({ where: { user: userWhere } }),
    );
    await silentDelete(
      prisma.passwordResetToken.deleteMany({ where: { user: userWhere } }),
    );
    await silentDelete(prisma.user.deleteMany({ where: userWhere }));
    await silentDelete(
      prisma.club.deleteMany({ where: { name: { contains: suffix } } }),
    );
  }

  return {
    user,
    club,
    competition,
    event,
    registration,
    license,
    partnership,
    result,
    cleanup,
  };
}
