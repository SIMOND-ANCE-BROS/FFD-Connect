import { randomUUID } from "crypto";
import { ConflictException, INestApplication } from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  UserRole,
} from "@prisma/client";
import { HealthDataRetentionService } from "../src/licenses/health-data-retention.service";
import { LicenseRenewalService } from "../src/licenses/license-renewal.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { OcrService } from "../src/utils/ocr.service";
import { buildHttpApp } from "./integration-app.builder";

/**
 * A document uploaded while its renewal request is being submitted (#297), on
 * a real database: the OCR is held open, the request is submitted meanwhile,
 * then the OCR finishes. The write re-reads the request under the user lock
 * and must refuse (409) instead of replacing a document of a request that
 * now awaits an administrator's decision.
 */
describe("Licence renewal: upload racing a submission (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: LicenseRenewalService;
  const userIds: string[] = [];

  let releaseOcr: () => void = () => undefined;
  let ocrStarted: Promise<void> = Promise.resolve();
  const mockOcr = {
    extractMedicalCertificateInfo: jest.fn(),
    extractLicenseInfo: jest.fn(),
  };

  /** The next medical-certificate OCR blocks until `releaseOcr()`. */
  const holdNextOcr = () => {
    let started: () => void = () => undefined;
    ocrStarted = new Promise<void>((resolve) => (started = resolve));
    const released = new Promise<void>((resolve) => (releaseOcr = resolve));
    mockOcr.extractMedicalCertificateInfo.mockImplementationOnce(async () => {
      started();
      await released;
      return { isApte: true };
    });
  };

  beforeAll(async () => {
    jest
      .spyOn(HealthDataRetentionService.prototype, "onModuleInit")
      .mockImplementation(() => undefined);
    ({ app, prisma } = await buildHttpApp({
      extra: (builder) =>
        builder.overrideProvider(OcrService).useValue(mockOcr),
    }));
    service = app.get(LicenseRenewalService);
  });

  afterEach(async () => {
    // Cascades to the requests and their documents.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  const createDraftWithDocuments = async () => {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Test",
        lastName: "UploadRace",
        role: UserRole.LICENSEE,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    const draft = await prisma.licenseRenewalRequest.create({
      data: {
        userId: user.id,
        status: LicenseRenewalStatus.DRAFT,
        documents: {
          create: [
            {
              type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
              filePath: "medical-original.pdf",
              ocrData: { isApte: true },
              purgeDueAt: new Date("2099-01-01T00:00:00Z"),
            },
            {
              type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
              filePath: "licence-original.png",
              ocrData: { licenseNumber: "FFD-297" },
            },
          ],
        },
      },
      select: { id: true },
    });
    return { userId: user.id, requestId: draft.id };
  };

  const documentsOf = (requestId: string) =>
    prisma.licenseRenewalDocument.findMany({
      where: { requestId },
      select: { type: true, filePath: true },
      orderBy: { type: "asc" },
      take: 10,
    });

  it("submission during the upload: 409, the submitted request keeps its documents", async () => {
    const { userId, requestId } = await createDraftWithDocuments();
    holdNextOcr();

    const upload = service.uploadRenewalDocument(
      userId,
      requestId,
      LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
      Buffer.from("replacement"),
      "medical-replacement.pdf",
    );
    // Keep the rejection observed while the submission runs.
    const outcome = upload.then(
      () => null,
      (error: unknown) => error,
    );
    await ocrStarted;

    const submitted = await service.submitRenewalRequest(userId, requestId);
    expect(submitted.status).toBe(LicenseRenewalStatus.PENDING);

    releaseOcr();
    expect(await outcome).toBeInstanceOf(ConflictException);

    expect(await documentsOf(requestId)).toEqual([
      {
        type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        filePath: "medical-original.pdf",
      },
      {
        type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
        filePath: "licence-original.png",
      },
    ]);
    const request = await prisma.licenseRenewalRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true },
    });
    expect(request.status).toBe(LicenseRenewalStatus.PENDING);
  });

  it("upload finished before the submission: the draft gets the new document", async () => {
    const { userId, requestId } = await createDraftWithDocuments();
    mockOcr.extractMedicalCertificateInfo.mockResolvedValueOnce({
      isApte: true,
    });

    await service.uploadRenewalDocument(
      userId,
      requestId,
      LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
      Buffer.from("replacement"),
      "medical-replacement.pdf",
    );

    expect(await documentsOf(requestId)).toContainEqual({
      type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
      filePath: "medical-replacement.pdf",
    });
  });
});
