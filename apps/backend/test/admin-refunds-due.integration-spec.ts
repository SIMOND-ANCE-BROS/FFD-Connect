/**
 * #627 on a real database: the federal administrator lists the refunds owed
 * by every organising club (`refundOwedAt` set on SeatBooking), with the club
 * that owes each one — the linked club (#408) or, for an unlinked
 * competition, its organiser label. Server-side filters, sort and paging.
 */
import { INestApplication } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildHttpApp } from "./integration-app.builder";

describe("Admin refunds due (#627, integration, real DB)", () => {
  const suffix = `admin-refunds-due-${Date.now()}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  let adminToken: string;
  let clubToken: string;
  let dancerId: string;
  let linkedBookingId: string;
  let unlinkedBookingId: string;

  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  const get = (token: string, query = "") =>
    request(http())
      .get(`/api/v1/admin/refunds-due${query}`)
      .set("Authorization", `Bearer ${token}`);

  type Row = {
    bookingId: string;
    club: { id: string | null; name: string | null };
    helloAssoCheckoutIntentIds: string[];
  };
  type Page = { data: Row[]; meta: Record<string, unknown> };

  /** Rows of this suite only: the database may hold other suites' data. */
  const mine = (body: unknown) =>
    (body as Page).data.filter((r) =>
      [linkedBookingId, unlinkedBookingId].includes(r.bookingId),
    );

  const filters = (list: unknown[]) =>
    `?filters=${encodeURIComponent(JSON.stringify(list))}`;

  beforeAll(async () => {
    const built = await buildHttpApp();
    app = built.app;
    prisma = built.prisma;
    f = createFactories(prisma, suffix, built.jwt);

    const club = await f.club({ name: `Club Lyon ${suffix}` });
    adminToken = (await f.user(UserRole.ADMIN)).token;
    clubToken = (
      await f.user(UserRole.CLUB, { clubId: club.id, clubName: club.name })
    ).token;
    const dancer = await f.user(UserRole.LICENSEE, {
      firstName: "Jeanne",
      lastName: `Martin${suffix}`,
    });
    dancerId = dancer.user.id;

    const linked = await f.competition({
      title: `Open lié ${suffix}`,
      organizer: "Libellé ignoré",
      organizerClubId: club.id,
    });
    const unlinked = await f.competition({
      title: `Bal non relié ${suffix}`,
      organizer: `Association Nice ${suffix}`,
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
          seatIndex: 0,
          status: "EXPIRED",
          paymentId: "800",
          expectedAmountCents: 2000,
          ...data,
        },
      });

    linkedBookingId = (
      await booking(linked.id, "table-1", {
        refundOwedPaymentIds: ["801"],
        refundOwedAt: new Date("2026-10-12T10:00:00Z"),
      })
    ).id;
    unlinkedBookingId = (
      await booking(unlinked.id, "table-1", {
        refundOwedPaymentIds: ["802", "803"],
        refundOwedAt: new Date("2026-10-11T10:00:00Z"),
      })
    ).id;
    // Settled: never listed.
    await booking(linked.id, "table-2", {});
  });

  afterAll(async () => {
    await prisma.seatBooking.deleteMany({ where: { userId: dancerId } });
    await f.cleanup();
    await app.close();
  });

  const dancerFilter = { field: "dancer", op: "contains", value: suffix };

  it("lists every club's refunds owed, oldest first, with the owing club", async () => {
    const res = await get(adminToken, filters([dancerFilter])).expect(200);
    const body = res.body as Page;

    expect(body.meta).toEqual({ total: 2, skip: 0, take: 20, hasMore: false });
    expect(body.data).toEqual([
      expect.objectContaining({
        bookingId: unlinkedBookingId,
        club: { id: null, name: `Association Nice ${suffix}` },
        helloAssoCheckoutIntentIds: ["802", "803"],
        seatNumber: 1,
        amountCents: 2000,
        refundOwedAt: "2026-10-11T10:00:00.000Z",
      }),
      expect.objectContaining({
        bookingId: linkedBookingId,
        club: {
          id: expect.any(String) as unknown,
          name: `Club Lyon ${suffix}`,
        },
        dancer: { firstName: "Jeanne", lastName: `Martin${suffix}` },
      }),
    ]);
  });

  it("filters on the linked club name or the organiser label", async () => {
    const lyon = await get(
      adminToken,
      filters([{ field: "club", op: "contains", value: `lyon ${suffix}` }]),
    ).expect(200);
    expect(mine(lyon.body).map((r) => r.bookingId)).toEqual([linkedBookingId]);

    const nice = await get(
      adminToken,
      filters([{ field: "club", op: "contains", value: `nice ${suffix}` }]),
    ).expect(200);
    expect(mine(nice.body).map((r) => r.bookingId)).toEqual([
      unlinkedBookingId,
    ]);
  });

  it("sorts and pages", async () => {
    const res = await get(
      adminToken,
      `${filters([dancerFilter])}&sortBy=refundOwedAt&sortOrder=desc&skip=1&take=1`,
    ).expect(200);
    const body = res.body as Page;

    expect(body.data.map((r) => r.bookingId)).toEqual([unlinkedBookingId]);
    expect(body.meta).toEqual({ total: 2, skip: 1, take: 1, hasMore: false });
  });

  it("refuses a club account (403)", async () => {
    await get(clubToken).expect(403);
  });

  it("rejects a page larger than 50 and an unknown filter (400)", async () => {
    await get(adminToken, "?take=51").expect(400);
    await get(
      adminToken,
      filters([{ field: "paymentId", op: "equals", value: "800" }]),
    ).expect(400);
  });
});
