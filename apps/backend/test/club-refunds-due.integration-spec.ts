/**
 * #516 on a real database: the organising club lists the refunds it owes
 * (`refundOwedPaymentIds` / `refundOwedAt` on SeatBooking), and only its own.
 */
import { INestApplication } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildHttpApp } from "./integration-app.builder";

describe("Club refunds due (#516, integration, real DB)", () => {
  const suffix = `refunds-due-${Date.now()}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  let clubAToken: string;
  let clubBToken: string;
  let licenseeToken: string;
  let dancerId: string;
  let owedBookingId: string;
  let olderOwedBookingId: string;

  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  const get = (token: string, query = "") =>
    request(http())
      .get(`/api/v1/clubs/me/refunds-due${query}`)
      .set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const built = await buildHttpApp();
    app = built.app;
    prisma = built.prisma;
    f = createFactories(prisma, suffix, built.jwt);

    const clubA = await f.club({ name: `Club A ${suffix}` });
    const clubB = await f.club({ name: `Club B ${suffix}` });
    clubAToken = (
      await f.user(UserRole.CLUB, { clubId: clubA.id, clubName: clubA.name })
    ).token;
    clubBToken = (
      await f.user(UserRole.CLUB, { clubId: clubB.id, clubName: clubB.name })
    ).token;
    const licensee = await f.user(UserRole.LICENSEE, {
      firstName: "Jeanne",
      lastName: "Martin",
    });
    licenseeToken = licensee.token;
    dancerId = licensee.user.id;

    // Free-text organiser with surrounding spaces and another case.
    const compA = await f.competition({
      organizer: ` ${clubA.name.toUpperCase()} `,
    });
    const compB = await f.competition({ organizer: clubB.name });

    const booking = (
      competitionId: string,
      itemId: string,
      data: Record<string, unknown>,
    ) =>
      prisma.seatBooking.create({
        data: {
          competitionId,
          userId: dancerId,
          itemId,
          seatIndex: 2,
          status: "EXPIRED",
          paymentId: "900",
          expectedAmountCents: 1500,
          ...data,
        },
      });

    owedBookingId = (
      await booking(compA.id, "table-1", {
        refundOwedPaymentIds: ["901", "902"],
        refundOwedAt: new Date("2026-10-12T10:00:00Z"),
      })
    ).id;
    olderOwedBookingId = (
      await booking(compA.id, "table-2", {
        status: "CONFIRMED",
        refundOwedPaymentIds: ["903"],
        refundOwedAt: new Date("2026-10-11T10:00:00Z"),
      })
    ).id;
    // Nothing owed (refund settled): not listed.
    await booking(compA.id, "table-3", {});
    // Club B's refund: never shown to club A.
    await booking(compB.id, "table-1", {
      refundOwedPaymentIds: ["904"],
      refundOwedAt: new Date("2026-10-10T10:00:00Z"),
    });
  });

  afterAll(async () => {
    await prisma.seatBooking.deleteMany({ where: { userId: dancerId } });
    await f.cleanup();
    await app.close();
  });

  it("lists the club's refunds owed, oldest first", async () => {
    const res = await get(clubAToken).expect(200);
    const body = res.body as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };

    expect(body.meta).toEqual({
      total: 2,
      skip: 0,
      take: 20,
      hasMore: false,
    });
    expect(body.data.map((r) => r.bookingId)).toEqual([
      olderOwedBookingId,
      owedBookingId,
    ]);
    expect(body.data[1]).toEqual({
      bookingId: owedBookingId,
      competition: expect.objectContaining({
        title: `Compétition ${suffix}`,
      }) as unknown,
      dancer: { firstName: "Jeanne", lastName: "Martin" },
      seatNumber: 3,
      amountCents: 1500,
      helloAssoCheckoutIntentIds: ["901", "902"],
      refundOwedAt: "2026-10-12T10:00:00.000Z",
    });
  });

  it("paginates", async () => {
    const res = await get(clubAToken, "?skip=1&take=1").expect(200);
    const body = res.body as {
      data: Array<{ bookingId: string }>;
      meta: { hasMore: boolean; total: number };
    };

    expect(body.data.map((r) => r.bookingId)).toEqual([owedBookingId]);
    expect(body.meta).toEqual(
      expect.objectContaining({ total: 2, hasMore: false }),
    );
  });

  it("shows another club only its own refunds", async () => {
    const res = await get(clubBToken).expect(200);
    const body = res.body as {
      data: Array<{ helloAssoCheckoutIntentIds: string[] }>;
    };

    expect(body.data.map((r) => r.helloAssoCheckoutIntentIds)).toEqual([
      ["904"],
    ]);
  });

  it("refuses a non-club account (403)", async () => {
    await get(licenseeToken).expect(403);
  });

  it("rejects a page larger than 50 (400)", async () => {
    await get(clubAToken, "?take=51").expect(400);
  });
});
