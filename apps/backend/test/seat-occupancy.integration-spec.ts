/**
 * Seat-plan occupancy (#454) over HTTP on a real database: per layout
 * element, the CONFIRMED (taken) and non-expired PENDING (held) seat
 * indexes. Public like the competition detail; a token only flags the
 * caller's own seats. No personal data, and lapsed holds do not count.
 */
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories, type TestUser } from "./factories";
import { buildHttpApp } from "./integration-app.builder";

describe("GET /competitions/:id/seat-occupancy (integration, real DB)", () => {
  const suffix = `seat-occupancy-454-${Date.now()}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let f: ReturnType<typeof createFactories>;
  let me: TestUser;
  let other: TestUser;
  let competitionId: string;

  const url = (id: string) => `/api/v1/competitions/${id}/seat-occupancy`;
  const inMinutes = (minutes: number) =>
    new Date(Date.now() + minutes * 60_000);

  beforeAll(async () => {
    ({ app, prisma, jwt } = await buildHttpApp());
    f = createFactories(prisma, suffix, jwt);
    me = await f.user();
    other = await f.user();
    competitionId = (
      await f.competition({
        layout: [
          {
            id: "table-8",
            type: "TABLE",
            capacity: 8,
            lockedSeats: [7],
            priceCents: 1500,
          },
          { id: "chairs", type: "OTHER", capacity: 3, priceCents: 500 },
          { id: "legacy", label: "Table 1", priceCents: 1500 },
        ],
      })
    ).id;

    const booking = (
      userId: string,
      itemId: string,
      seatIndex: number | null,
      status: "PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELLED",
      expiresAt: Date | null,
      pendingSlot: number | null = null,
    ) => ({
      competitionId,
      userId,
      itemId,
      seatIndex,
      status,
      expiresAt,
      pendingSlot,
      seatLabel: `Secret label ${other.user.lastName}`,
      paymentId: `pay-${Math.random().toString(36).slice(2)}`,
    });

    await prisma.seatBooking.createMany({
      data: [
        booking(other.user.id, "table-8", 0, "CONFIRMED", null),
        booking(me.user.id, "table-8", 3, "CONFIRMED", null),
        booking(me.user.id, "table-8", 4, "PENDING", inMinutes(30), 0),
        booking(other.user.id, "table-8", 5, "PENDING", inMinutes(30), 0),
        // Lapsed hold still PENDING in the database (lazy expiry): free.
        booking(other.user.id, "table-8", 6, "PENDING", inMinutes(-1), 1),
        // History never blocks a seat.
        booking(other.user.id, "table-8", 1, "EXPIRED", inMinutes(-60)),
        booking(other.user.id, "table-8", 2, "CANCELLED", null),
        booking(other.user.id, "chairs", 0, "CONFIRMED", null),
        booking(me.user.id, "chairs", 1, "PENDING", inMinutes(30), 1),
        // Pre-#428 booking: the whole element.
        booking(other.user.id, "legacy", null, "CONFIRMED", null),
      ],
    });
  });

  afterAll(async () => {
    await prisma.seatBooking.deleteMany({ where: { competitionId } });
    await f.cleanup();
    await app.close();
  });

  it("is public: taken and non-expired held seats per element", async () => {
    const res = await request(app.getHttpServer())
      .get(url(competitionId))
      .expect(200);

    expect(res.body).toEqual({
      competitionId,
      elements: [
        {
          itemId: "table-8",
          mode: "numbered",
          available: 3, // 1, 2 and 6 (7 is locked)
          taken: 2,
          held: 2,
          mine: 0,
          takenSeats: [0, 3],
          heldSeats: [4, 5],
          mySeats: [],
          wholeElementBooked: false,
        },
        {
          itemId: "chairs",
          mode: "free",
          available: 1,
          taken: 1,
          held: 1,
          mine: 0,
          takenSeats: [],
          heldSeats: [],
          mySeats: [],
          wholeElementBooked: false,
        },
        {
          itemId: "legacy",
          mode: "free",
          available: 0,
          taken: 1,
          held: 0,
          mine: 0,
          takenSeats: [],
          heldSeats: [],
          mySeats: [],
          wholeElementBooked: true,
        },
      ],
    });
  });

  it("flags the authenticated caller's own seats", async () => {
    const res = await request(app.getHttpServer())
      .get(url(competitionId))
      .set("Authorization", `Bearer ${me.token}`)
      .expect(200);

    const [table, chairs] = res.body.elements as Array<{
      mine: number;
      mySeats: number[];
    }>;
    expect(table.mySeats).toEqual([3, 4]);
    expect(table.mine).toBe(2);
    expect(chairs.mine).toBe(1);
  });

  it("an invalid token is served as anonymous, like the public detail", async () => {
    const res = await request(app.getHttpServer())
      .get(url(competitionId))
      .set("Authorization", "Bearer not-a-jwt")
      .expect(200);
    expect(res.body.elements[0].mySeats).toEqual([]);
  });

  it("returns no personal data", async () => {
    const res = await request(app.getHttpServer())
      .get(url(competitionId))
      .set("Authorization", `Bearer ${me.token}`)
      .expect(200);
    const text = JSON.stringify(res.body);
    for (const leak of [
      other.user.id,
      me.user.id,
      other.user.email,
      other.user.lastName,
      "Secret label",
      "pay-",
    ]) {
      expect(text).not.toContain(leak);
    }
    expect(text).not.toMatch(/userId|bookingId|paymentId|seatLabel/);
  });

  it("404s on an unknown competition", async () => {
    await request(app.getHttpServer())
      .get(url("00000000-0000-0000-0000-000000000000"))
      .expect(404);
  });
});
