import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "./../src/prisma/prisma.service";
import { buildHttpApp } from "./integration-app.builder";
import { createFactories } from "./factories";

describe("LicensesController (integration with real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  const suffix = `lic-${Date.now()}`;

  beforeAll(async () => {
    const built = await buildHttpApp();
    app = built.app;
    prisma = built.prisma;
    f = createFactories(prisma, suffix, built.jwt);
  }, 30000);

  afterAll(async () => {
    await f.cleanup();
    await app.close();
  }, 15000);

  // ---------------------------------------------------------------------------
  // GET /licenses/my
  // ---------------------------------------------------------------------------

  describe("GET /licenses/my", () => {
    it("returns 401 when no token is provided", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .expect(401);
    });

    it("returns 401 when a malformed bearer token is provided", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", "Bearer not.a.valid.jwt")
        .expect(401);
    });

    it("returns 404 when the authenticated user has no license", async () => {
      const { token } = await f.user();

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });

    it("returns 200 with license data when user has a license", async () => {
      const { user, token } = await f.user();
      await f.license(user.id, {
        number: `TEST-${suffix}-basic`,
        category: "Latin",
      });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("id");
          expect(res.body).toHaveProperty("number", `TEST-${suffix}-basic`);
          expect(res.body).toHaveProperty("category", "Latin");
          expect(res.body).toHaveProperty("validUntil");
        });
    });

    it("license response contains a userId field", async () => {
      const { user, token } = await f.user();
      await f.license(user.id, { number: `TEST-${suffix}-userid` });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("userId", user.id);
        });
    });

    it("license response contains a clubName field", async () => {
      const { user, token } = await f.user();
      await f.license(user.id, {
        number: `TEST-${suffix}-clubname`,
        clubName: "Club Test",
      });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("clubName", "Club Test");
        });
    });

    it("license response contains a clubName when one is set", async () => {
      const { user, token } = await f.user();
      await f.license(user.id, {
        number: `TEST-${suffix}-clubname2`,
        clubName: "Club de Danse Paris",
      });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("clubName", "Club de Danse Paris");
        });
    });

    it("license response contains a validUntil date string", async () => {
      const { user, token } = await f.user();
      await f.license(user.id, { number: `TEST-${suffix}-validuntil` });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("validUntil");
          expect(typeof res.body.validUntil).toBe("string");
          expect(new Date(res.body.validUntil as string).toString()).not.toBe(
            "Invalid Date",
          );
        });
    });

    it("license response contains createdAt and updatedAt timestamps", async () => {
      const { user, token } = await f.user();
      await f.license(user.id, { number: `TEST-${suffix}-timestamps` });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("createdAt");
          expect(res.body).toHaveProperty("updatedAt");
        });
    });

    it("license response contains qrCodeSignature field (may be null)", async () => {
      const { user, token } = await f.user();
      await f.license(user.id, { number: `TEST-${suffix}-qr` });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(Object.keys(res.body as object)).toContain("qrCodeSignature");
        });
    });

    it("returns the correct license number as stored in the database", async () => {
      const { user, token } = await f.user();
      const licenseNumber = `TEST-${suffix}-exact`;
      await f.license(user.id, { number: licenseNumber });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.number).toBe(licenseNumber);
        });
    });

    it("two different users each see only their own license", async () => {
      const firstUser = await f.user();
      const secondUser = await f.user();

      await f.license(firstUser.user.id, { number: `TEST-${suffix}-first` });
      await f.license(secondUser.user.id, { number: `TEST-${suffix}-second` });

      const firstRes = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${firstUser.token}`)
        .expect(200);

      expect((firstRes.body as { number: string }).number).toBe(
        `TEST-${suffix}-first`,
      );

      const secondRes = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${secondUser.token}`)
        .expect(200);

      expect((secondRes.body as { number: string }).number).toBe(
        `TEST-${suffix}-second`,
      );
    });

    it("returns 404 after the license has been deleted from the database", async () => {
      const { user, token } = await f.user();
      const lic = await f.license(user.id, { number: `TEST-${suffix}-delete` });

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      await prisma.license.delete({
        where: { id: (lic as { id: string }).id },
      });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/licenses/my")
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });
});
