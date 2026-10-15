/**
 * Parental consent of minors (#61) against a real Postgres, through HTTP.
 *
 * The whole double opt-in runs for real: registration of a minor with a
 * parent's address, the hashed token, the parent's lookup / confirm / revoke,
 * the health-data gate of the licence renewal, the real effect of a
 * withdrawal on the minor's certificates, and the GDPR export. Only the
 * e-mail transport is faked, to capture the link a parent would receive.
 */
import { ForbiddenException, INestApplication } from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
} from "@prisma/client";
import request from "supertest";
import { LicenseRenewalService } from "../src/licenses/license-renewal.service";
import { ParentalConsentEmailService } from "../src/parental-consent/parental-consent-email.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { UsersService } from "../src/users/users.service";
import { OcrService } from "../src/utils/ocr.service";
import { hashToken } from "../src/utils/token-hash.util";
import { buildHttpApp } from "./integration-app.builder";

const API = "/api/v1";
const PASSWORD = "Password123!";

describe("Parental consent (integration, real DB, #61)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sent: Array<{ to: string; firstName: string; token: string }> = [];
  const suffix = Date.now().toString(36);
  const created: string[] = [];
  const numbers: string[] = [];

  const mailer = {
    consentUrl: (token: string) => `https://test/?token=${token}`,
    sendConsentRequest: jest.fn(
      async (to: string, firstName: string, token: string) => {
        sent.push({ to, firstName, token });
      },
    ),
  };

  /** Registers through the real endpoint; the licence number encodes the birth date. */
  async function register(
    birth: string,
    letters: string,
    extra: Record<string, string> = {},
  ) {
    const number = `${birth}-tst-${letters}`;
    numbers.push(number);
    await prisma.license.deleteMany({ where: { number } });
    await prisma.license.create({
      data: {
        number,
        category: "Latin",
        clubName: "Club test",
        validUntil: new Date("2099-08-31"),
      },
    });
    const email = `pc-${letters}-${suffix}@integ.test`;
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/register`)
      .send({
        email,
        password: PASSWORD,
        licenseNumber: number,
        lastName: "Martin",
        firstName: "Léa",
        ...extra,
      })
      .expect(201);
    created.push(res.body.user.id);
    return {
      id: res.body.user.id as string,
      token: res.body.access_token as string,
      email,
    };
  }

  const me = (token: string) =>
    request(app.getHttpServer())
      .get(`${API}/parental-consent/me`)
      .set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const built = await buildHttpApp({
      redis: true,
      extra: (builder) =>
        builder
          .overrideProvider(ParentalConsentEmailService)
          .useValue(mailer)
          .overrideProvider(OcrService)
          .useValue({
            extractMedicalCertificateInfo: jest.fn().mockResolvedValue({}),
            extractLicenseInfo: jest.fn().mockResolvedValue({}),
          }),
    });
    app = built.app;
    prisma = built.prisma;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await prisma.license.deleteMany({ where: { number: { in: numbers } } });
    await app.close();
  });

  it("never subjects an adult to the flow", async () => {
    const adult = await register("19900101", "ad01", {
      parentEmail: "parent-adult@integ.test",
    });

    const res = await me(adult.token).expect(200);

    expect(res.body.state).toBe("NOT_REQUIRED");
    expect(
      await prisma.parentalConsent.count({ where: { userId: adult.id } }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/request`)
      .set("Authorization", `Bearer ${adult.token}`)
      .send({ parentEmail: "parent@integ.test" })
      .expect(400);
  });

  it("runs the whole double opt-in, gate and withdrawal included", async () => {
    sent.length = 0;
    const minor = await register("20120301", "mi01", {
      parentEmail: "Parent.Martin@Integ.test",
    });

    // 1. Registration sent the link; only hashes are stored.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("parent.martin@integ.test");
    expect(sent[0].firstName).toBe("Léa");
    const firstToken = sent[0].token;
    const row = await prisma.parentalConsent.findFirstOrThrow({
      where: { userId: minor.id },
    });
    expect(row.tokenHash).toBe(hashToken(firstToken));
    expect(row.parentEmailHash).toBe(hashToken("parent.martin@integ.test"));
    expect(row.parentEmailMasked).toBe("p***@i***.test");
    expect(JSON.stringify(row)).not.toContain("parent.martin");

    let state = (await me(minor.token).expect(200)).body;
    expect(state).toMatchObject({
      state: "PENDING",
      parentEmailMasked: "p***@i***.test",
    });

    // 2. Pending: no medical certificate.
    const renewal = moduleService(LicenseRenewalService);
    const draft = await renewal.startRenewalRequest(minor.id);
    await expect(
      renewal.uploadRenewalDocument(
        minor.id,
        draft.id,
        LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        Buffer.from("pdf"),
        `cert-${suffix}.pdf`,
      ),
    ).rejects.toThrow(ForbiddenException);

    // 3. Re-send: the first link stops working.
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/request`)
      .set("Authorization", `Bearer ${minor.token}`)
      .send({ parentEmail: "parent.martin@integ.test" })
      .expect(200);
    const token = sent[sent.length - 1].token;
    expect(token).not.toBe(firstToken);
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/lookup`)
      .send({ token: firstToken })
      .expect(400);

    // 4. The parent reads and confirms (both agreements required).
    const lookup = await request(app.getHttpServer())
      .post(`${API}/parental-consent/lookup`)
      .send({ token })
      .expect(200);
    expect(lookup.body).toMatchObject({
      childFirstName: "Léa",
      state: "PENDING",
    });
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/confirm`)
      .send({ token, acceptDataProcessing: true, acceptHealthData: false })
      .expect(400);
    const confirmed = await request(app.getHttpServer())
      .post(`${API}/parental-consent/confirm`)
      .send({ token, acceptDataProcessing: true, acceptHealthData: true })
      .expect(200);
    expect(confirmed.body.state).toBe("GRANTED");
    // Idempotent on a double click.
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/confirm`)
      .send({ token, acceptDataProcessing: true, acceptHealthData: true })
      .expect(200);

    state = (await me(minor.token).expect(200)).body;
    expect(state.state).toBe("GRANTED");
    expect(state.grantedAt).toEqual(expect.any(String));
    const granted = await prisma.parentalConsent.findFirstOrThrow({
      where: { userId: minor.id, status: "GRANTED" },
    });
    expect(granted.cguVersion).toBe("3");

    // A granted consent is never replaced by a new request.
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/request`)
      .set("Authorization", `Bearer ${minor.token}`)
      .send({ parentEmail: "other@integ.test" })
      .expect(409);

    // 5. Granted: the certificate goes through, the renewal is submitted.
    await renewal.uploadRenewalDocument(
      minor.id,
      draft.id,
      LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
      Buffer.from("pdf"),
      `cert-${suffix}.pdf`,
    );
    await renewal.uploadRenewalDocument(
      minor.id,
      draft.id,
      LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
      Buffer.from("pdf"),
      `lic-${suffix}.pdf`,
    );
    await prisma.licenseRenewalRequest.update({
      where: { id: draft.id },
      data: {
        status: LicenseRenewalStatus.PENDING,
        submittedAt: new Date(),
      },
    });

    // 6. The same link withdraws: real effect on health data.
    const revoked = await request(app.getHttpServer())
      .post(`${API}/parental-consent/revoke`)
      .send({ token })
      .expect(200);
    expect(revoked.body.state).toBe("REVOKED");

    state = (await me(minor.token).expect(200)).body;
    expect(state).toMatchObject({ state: "REQUIRED", lastOutcome: "REVOKED" });
    const after = await prisma.licenseRenewalRequest.findUniqueOrThrow({
      where: { id: draft.id },
      select: {
        status: true,
        submittedAt: true,
        documents: { select: { type: true, ocrData: true, purgeDueAt: true } },
      },
    });
    expect(after.status).toBe(LicenseRenewalStatus.DRAFT);
    expect(after.submittedAt).toBeNull();
    const certificate = after.documents.find(
      (d) => d.type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
    );
    expect(certificate?.ocrData).toBeNull();
    expect(certificate?.purgeDueAt?.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(
      renewal.submitRenewalRequest(minor.id, draft.id),
    ).rejects.toThrow(ForbiddenException);

    // A withdrawn link can neither confirm again nor fail a second withdrawal.
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/confirm`)
      .send({ token, acceptDataProcessing: true, acceptHealthData: true })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/revoke`)
      .send({ token })
      .expect(200);

    // 7. GDPR export: the trail, without any hash.
    const exported = await moduleService(UsersService).exportMyData(minor.id);
    const consents = (exported.data as Record<string, unknown>)
      .parentalConsents as Array<Record<string, unknown>>;
    expect(consents.map((c) => c.status).sort()).toEqual([
      "REVOKED",
      "SUPERSEDED",
    ]);
    expect(JSON.stringify(consents)).not.toMatch(/tokenHash|parentEmailHash/);
  });

  it("rejects malformed tokens before any lookup", async () => {
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/lookup`)
      .send({ token: "not-hex" })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${API}/parental-consent/lookup`)
      .send({ token: "f".repeat(64) })
      .expect(400);
  });

  function moduleService<T>(cls: new (...args: never[]) => T): T {
    return app.get(cls);
  }
});
