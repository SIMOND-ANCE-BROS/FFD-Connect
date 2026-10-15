/**
 * #516 on a real database: the organising club lists the refunds it owes
 * (`refundOwedPaymentIds` / `refundOwedAt` on SeatBooking), and only its own —
 * the organising club is the `organizerClubId` link (#408), a homonym club
 * never sees another club's dancers.
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
  let homonymToken: string;
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

  type Page = {
    data: Array<{ bookingId: string; helloAssoCheckoutIntentIds: string[] }>;
    meta: Record<string, unknown>;
  };

  const intentIdsOf = (body: unknown) =>
    (body as Page).data.map((r) => r.helloAssoCheckoutIntentIds);

  beforeAll(async () => {
    const built = await buildHttpApp();
    app = built.app;
    prisma = built.prisma;
    f = createFactories(prisma, suffix, built.jwt);

    const clubA = await f.club({ name: `Club A ${suffix}` });
    // Homonym: same name but for the case (Club.name is unique).
    const homonym = await f.club({ name: `CLUB A ${suffix}` });
    const clubB = await f.club({ name: `Club B ${suffix}` });
    const manager = async (club: { id: string; name: string }) =>
      (await f.user(UserRole.CLUB, { clubId: club.id, clubName: club.name }))
        .token;
    clubAToken = await manager(clubA);
    homonymToken = await manager(homonym);
    clubBToken = await manager(clubB);
    const licensee = await f.user(UserRole.LICENSEE, {
      firstName: "Jeanne",
      lastName: "Martin",
    });
    licenseeToken = licensee.token;
    dancerId = licensee.user.id;

    // Linked to club A (label irrelevant once linked).
    const compA = await f.competition({
      organizer: clubA.name,
      organizerClubId: clubA.id,
    });
    // Same label as club A, but linked to the homonym: never club A's.
    const compHomonym = await f.competition({
      organizer: clubA.name,
      organizerClubId: homonym.id,
    });
    // Unlinked, label ambiguous between club A and its homonym: nobody's.
    const compAmbiguous = await f.competition({ organizer: clubA.name });
    // Unlinked, label naming exactly one club (case-insensitive): club B's.
    // Surrounding spaces are not trimmed by the shared organiser rule (#625).
    const compB = await f.competition({
      organizer: clubB.name.toUpperCase(),
    });

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
    const owed = (intentIds: string[], at: string) => ({
      refundOwedPaymentIds: intentIds,
      refundOwedAt: new Date(at),
    });

    owedBookingId = (
      await booking(
        compA.id,
        "table-1",
        owed(["901", "902"], "2026-10-12T10:00:00Z"),
      )
    ).id;
    olderOwedBookingId = (
      await booking(compA.id, "table-2", {
        status: "CONFIRMED",
        ...owed(["903"], "2026-10-11T10:00:00Z"),
      })
    ).id;
    // Nothing owed (refund settled): not listed.
    await booking(compA.id, "table-3", {});
    await booking(
      compHomonym.id,
      "table-1",
      owed(["905"], "2026-10-09T10:00:00Z"),
    );
    await booking(
      compAmbiguous.id,
      "table-1",
      owed(["906"], "2026-10-08T10:00:00Z"),
    );
    await booking(compB.id, "table-1", owed(["904"], "2026-10-10T10:00:00Z"));
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
    const body = res.body as Page;

    expect(body.data.map((r) => r.bookingId)).toEqual([owedBookingId]);
    expect(body.meta).toEqual(
      expect.objectContaining({ total: 2, hasMore: false }),
    );
  });

  it("shows a homonym club only the competitions linked to it", async () => {
    const res = await get(homonymToken).expect(200);

    expect(intentIdsOf(res.body)).toEqual([["905"]]);
  });

  it("falls back to an unambiguous label for an unlinked competition", async () => {
    const res = await get(clubBToken).expect(200);

    expect(intentIdsOf(res.body)).toEqual([["904"]]);
  });

  it("refuses a non-club account (403)", async () => {
    await get(licenseeToken).expect(403);
  });

  it("rejects a page larger than 50 (400)", async () => {
    await get(clubAToken, "?take=51").expect(400);
  });
});
