import { randomUUID } from "crypto";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildHttpApp } from "./integration-app.builder";

/**
 * Column filters with operators on a real database (#557): the Prisma where
 * built from `filters` is run by PostgreSQL, on the user list (search narrows
 * every request to the rows of this run).
 */
describe("Admin list filters (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const marker = `flt${randomUUID().slice(0, 8)}`;
  const ids: Record<"admin" | "a" | "b" | "c", string> = {
    admin: randomUUID(),
    a: randomUUID(),
    b: randomUUID(),
    c: randomUUID(),
  };
  let adminToken = "";

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  /** Last names of this run's users matching `filters`, sorted. */
  const names = async (filters: unknown): Promise<string[]> => {
    const res = await request(server())
      .get("/api/v1/admin/users")
      .query({ search: marker, take: 100, filters: JSON.stringify(filters) })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const body = res.body as { data: { lastName: string }[] };
    return body.data.map((u) => u.lastName).sort();
  };

  beforeAll(async () => {
    ({ app, prisma, jwt } = await buildHttpApp());
    const base = { password: "x", firstName: "Test" };
    await prisma.user.create({
      data: {
        ...base,
        id: ids.admin,
        email: `${ids.admin}@admin.test`,
        lastName: "Admin",
        role: UserRole.ADMIN,
      },
    });
    adminToken = jwt.sign({
      sub: ids.admin,
      email: `${ids.admin}@admin.test`,
      role: UserRole.ADMIN,
    });
    await prisma.user.createMany({
      data: [
        {
          ...base,
          id: ids.a,
          email: `a@${marker}.test`,
          lastName: "MARTIN",
          firstName: "Zoé",
          clubName: "Paris Danse",
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.CLUB],
          // 23:30 UTC on 10 March = 00:30 on 11 March in Paris.
          createdAt: new Date("2026-03-10T23:30:00.000Z"),
        },
        {
          ...base,
          id: ids.b,
          email: `b@${marker}.test`,
          lastName: "Durand",
          clubName: null,
          role: UserRole.CLUB,
          createdAt: new Date("2026-03-12T10:00:00.000Z"),
          lastLoginAt: new Date("2026-05-01T10:00:00.000Z"),
        },
        {
          ...base,
          id: ids.c,
          email: `c@${marker}.test`,
          lastName: "Petit",
          clubName: "",
          role: UserRole.LICENSEE,
          createdAt: new Date("2026-04-01T10:00:00.000Z"),
        },
      ],
    });
    await prisma.license.create({
      data: {
        number: `FLT-${marker}`,
        validUntil: new Date("2027-08-31T00:00:00.000Z"),
        category: "Latin",
        clubName: "Paris Danse",
        userId: ids.a,
      },
    });
  });

  afterAll(async () => {
    await prisma.license.deleteMany({ where: { userId: ids.a } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await app.close();
  });

  it("text: contains / starts with / equals, case-insensitively", async () => {
    expect(
      await names([{ field: "name", op: "contains", value: "mart" }]),
    ).toEqual(["MARTIN"]);
    // The first name counts too.
    expect(
      await names([{ field: "name", op: "startsWith", value: "zo" }]),
    ).toEqual(["MARTIN"]);
    expect(
      await names([{ field: "club", op: "equals", value: "paris danse" }]),
    ).toEqual(["MARTIN"]);
  });

  it("text: « ne contient pas » keeps the users without a club", async () => {
    expect(
      await names([{ field: "club", op: "notContains", value: "paris" }]),
    ).toEqual(["Durand", "Petit"]);
  });

  it("text: « est vide » matches NULL and the empty string", async () => {
    expect(await names([{ field: "club", op: "isEmpty" }])).toEqual([
      "Durand",
      "Petit",
    ]);
    expect(await names([{ field: "club", op: "isNotEmpty" }])).toEqual([
      "MARTIN",
    ]);
  });

  it("text on a relation: licence number", async () => {
    expect(
      await names([
        { field: "licenseNumber", op: "startsWith", value: "flt-" },
      ]),
    ).toEqual(["MARTIN"]);
    expect(await names([{ field: "licenseNumber", op: "isEmpty" }])).toEqual([
      "Durand",
      "Petit",
    ]);
  });

  it("dates are Paris days", async () => {
    expect(
      await names([{ field: "createdAt", op: "eq", value: "2026-03-11" }]),
    ).toEqual(["MARTIN"]);
    expect(
      await names([{ field: "createdAt", op: "lt", value: "2026-03-11" }]),
    ).toEqual([]);
    expect(
      await names([
        {
          field: "createdAt",
          op: "between",
          value: ["2026-03-11", "2026-03-12"],
        },
      ]),
    ).toEqual(["Durand", "MARTIN"]);
    expect(
      await names([{ field: "createdAt", op: "gt", value: "2026-03-12" }]),
    ).toEqual(["Petit"]);
    expect(await names([{ field: "lastLoginAt", op: "isEmpty" }])).toEqual([
      "MARTIN",
      "Petit",
    ]);
  });

  it("enum: role is one of / none of, main or extra role", async () => {
    expect(await names([{ field: "role", op: "in", value: ["CLUB"] }])).toEqual(
      ["Durand", "MARTIN"],
    );
    expect(
      await names([{ field: "role", op: "notIn", value: ["CLUB"] }]),
    ).toEqual(["Petit"]);
  });

  it("several filters are combined with AND", async () => {
    expect(
      await names([
        { field: "role", op: "in", value: ["CLUB"] },
        { field: "lastLoginAt", op: "isEmpty" },
      ]),
    ).toEqual(["MARTIN"]);
  });

  it("several conditions on one column: OR, AND, still ANDed with the others (#673)", async () => {
    expect(
      await names([
        { field: "email", op: "startsWith", value: "a@", join: "or" },
        { field: "email", op: "startsWith", value: "c@", join: "or" },
      ]),
    ).toEqual(["MARTIN", "Petit"]);
    expect(
      await names([
        { field: "name", op: "contains", value: "r" },
        { field: "name", op: "notContains", value: "mart" },
      ]),
    ).toEqual(["Durand"]);
    expect(
      await names([
        { field: "createdAt", op: "lt", value: "2026-03-11", join: "or" },
        { field: "createdAt", op: "gt", value: "2026-03-31", join: "or" },
      ]),
    ).toEqual(["Petit"]);
    expect(
      await names([
        { field: "role", op: "in", value: ["CLUB"], join: "or" },
        { field: "role", op: "notIn", value: ["CLUB"], join: "or" },
        { field: "club", op: "isEmpty" },
      ]),
    ).toEqual(["Durand", "Petit"]);
  });

  it("refuses too many conditions on one column (#673)", async () => {
    await request(server())
      .get("/api/v1/admin/users")
      .query({
        filters: JSON.stringify(
          Array.from({ length: 6 }, (_, i) => ({
            field: "name",
            op: "contains",
            value: `x${i}`,
            join: "or",
          })),
        ),
      })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
  });

  it("refuses a field outside the whitelist", async () => {
    await request(server())
      .get("/api/v1/admin/users")
      .query({
        filters: JSON.stringify([
          { field: "password", op: "startsWith", value: "$2" },
        ]),
      })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
  });
});
