import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { LicenseQrService } from "./../src/licenses/qr/license-qr.service";
import { AppleWalletPassGenerator } from "./../src/licenses/wallet/apple-wallet-pass.generator";
import { hashWalletPassToken } from "./../src/licenses/wallet/apple-wallet-pass.service";
import {
  readPkpassEntries,
  testAppleWalletEnv,
} from "./../src/licenses/wallet/test-certificates.mock";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

/**
 * Apple Wallet license pass, end to end (#162): authenticated POST issues a
 * single-use link, the public GET exchanges it for a signed `.pkpass` whose
 * QR is exactly the one the app shows.
 */
describe("Apple Wallet license pass (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let aliceToken: string;
  let bobToken: string;
  let noLicenseToken: string;
  let expiredToken: string;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  const binary = (
    res: NodeJS.ReadableStream,
    callback: (err: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => callback(null, Buffer.concat(chunks)));
  };

  const issueLink = (jwt: string) =>
    request(server())
      .post("/api/v1/licenses/my/wallet/apple")
      .set("Authorization", `Bearer ${jwt}`);

  const download = (path: string) =>
    request(server()).get(`/api/v1/${path}`).buffer(true).parse(binary);

  beforeAll(async () => {
    const config = (values: Record<string, string>) =>
      ({ get: (key: string) => values[key] }) as unknown as ConfigService;
    const qrService = new LicenseQrService(
      config({ QR_SIGNING_SECRET: "e2e-only-qr-signing-secret-0123456789" }),
    );
    const generator = new AppleWalletPassGenerator(
      config(testAppleWalletEnv()),
      qrService,
    );

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(LicenseQrService)
        .useValue(qrService)
        .overrideProvider(AppleWalletPassGenerator)
        .useValue(generator)
        .overrideProvider(RedisService)
        .useValue({
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
          deleteByPattern: jest.fn().mockResolvedValue(undefined),
          keys: jest.fn().mockResolvedValue([]),
          exists: jest.fn().mockResolvedValue(false),
          isAvailable: jest.fn().mockReturnValue(false),
          getClient: jest.fn().mockReturnValue(null),
          onModuleDestroy: jest.fn(),
        }),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    const jwtService = moduleFixture.get<JwtService>(JwtService);

    await prisma.walletPassDownloadToken.deleteMany();
    await prisma.license.deleteMany({
      where: { number: { startsWith: "FFD-WALLET-" } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: "@wallet-e2e.test" } },
    });

    const createUser = async (
      name: string,
      license?: { number: string; validUntil: Date },
    ) => {
      const user = await prisma.user.create({
        data: {
          email: `${name}@wallet-e2e.test`,
          password: "hash",
          firstName: name,
          lastName: "Wallet",
          role: UserRole.LICENSEE,
          ...(license
            ? {
                license: {
                  create: {
                    ...license,
                    category: "Standard",
                    clubName: "Club Wallet",
                  },
                },
              }
            : {}),
        },
      });
      return jwtService.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
    };

    const inFourMonths = new Date(Date.now() + 120 * 86_400_000);
    aliceToken = await createUser("alice", {
      number: "FFD-WALLET-A",
      validUntil: inFourMonths,
    });
    bobToken = await createUser("bob", {
      number: "FFD-WALLET-B",
      validUntil: inFourMonths,
    });
    expiredToken = await createUser("old", {
      number: "FFD-WALLET-OLD",
      validUntil: new Date(Date.now() - 3 * 86_400_000),
    });
    noLicenseToken = await createUser("none");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: "@wallet-e2e.test" } },
    });
    await app.close();
  });

  it("tells the app the feature is available", async () => {
    const me = await request(server())
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);
    expect(me.body.license.appleWalletAvailable).toBe(true);

    const license = await request(server())
      .get("/api/v1/licenses/my")
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);
    expect(license.body.appleWalletAvailable).toBe(true);
  });

  it("requires authentication to issue a link", async () => {
    await request(server())
      .post("/api/v1/licenses/my/wallet/apple")
      .expect(401);
  });

  it("404 without a license, 422 with an expired one", async () => {
    await issueLink(noLicenseToken).expect(404);
    await issueLink(expiredToken).expect(422);
  });

  it("POST → GET returns the signed pass of the caller, exactly once", async () => {
    const link = await issueLink(aliceToken).expect(201);
    const { url, path } = link.body as { url: string; path: string };
    expect(url).toMatch(
      /^http:\/\/[^/]+\/api\/v1\/licenses\/wallet\/apple\/[A-Za-z0-9_-]{43}$/,
    );
    expect(url.endsWith(path)).toBe(true);

    // Only the hash is stored.
    const token = path.split("/").pop() as string;
    const rows = await prisma.walletPassDownloadToken.findMany({
      take: 10,
    });
    expect(rows.map((r) => r.tokenHash)).toContain(hashWalletPassToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);

    const res = await download(path).expect(200);
    expect(res.headers["content-type"]).toBe("application/vnd.apple.pkpass");
    expect(res.headers["cache-control"]).toBe("no-store");

    const entries = readPkpassEntries(res.body as Buffer);
    expect(entries.signature.length).toBeGreaterThan(0);
    const passJson = JSON.parse(entries["pass.json"].toString("utf8")) as {
      barcodes: { message: string }[];
      generic: { secondaryFields: { value: string }[] };
    };

    const me = await request(server())
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);
    expect(passJson.barcodes[0].message).toBe(me.body.license.qrCode);
    expect(passJson.generic.secondaryFields[0].value).toBe("FFD-WALLET-A");

    // Single use.
    await download(path).expect(404);
  });

  it("a token only ever yields its issuer's pass", async () => {
    const alice = (await issueLink(aliceToken).expect(201)).body as {
      path: string;
    };
    const bob = (await issueLink(bobToken).expect(201)).body as {
      path: string;
    };

    const bobPass = readPkpassEntries(
      (await download(bob.path).expect(200)).body as Buffer,
    );
    expect(bobPass["pass.json"].toString("utf8")).toContain("FFD-WALLET-B");
    expect(bobPass["pass.json"].toString("utf8")).not.toContain("FFD-WALLET-A");

    // Alice's link is unaffected by Bob's.
    await download(alice.path).expect(200);
  });

  it("a new link invalidates the previous one", async () => {
    const first = (await issueLink(aliceToken).expect(201)).body as {
      path: string;
    };
    await issueLink(aliceToken).expect(201);
    await download(first.path).expect(404);
  });

  it("410 once the link has expired", async () => {
    const { path } = (await issueLink(bobToken).expect(201)).body as {
      path: string;
    };
    const token = path.split("/").pop() as string;
    await prisma.walletPassDownloadToken.update({
      where: { tokenHash: hashWalletPassToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await download(path).expect(410);
    await download(path).expect(404);
  });

  it("400 for a malformed token", async () => {
    await download("licenses/wallet/apple/not-a-token").expect(400);
  });
});
