import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { AcknowledgePrivacyPolicyDto } from "./dto/privacy-policy-notice.dto";
import { PrivacyPolicyController } from "./privacy-policy.controller";
import { PrivacyPolicyNoticeQueryService } from "./privacy-policy-notice.query-service";
import { PrivacyPolicyNoticeService } from "./privacy-policy-notice.service";

describe("PrivacyPolicyController (#734)", () => {
  const query = { getNotice: jest.fn() };
  const service = { acknowledge: jest.fn() };
  const req = { user: { userId: "u1" } } as unknown as RequestWithUser;
  let controller: PrivacyPolicyController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [PrivacyPolicyController],
      providers: [
        { provide: PrivacyPolicyNoticeQueryService, useValue: query },
        { provide: PrivacyPolicyNoticeService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(NoImpersonationGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PrivacyPolicyController);
  });

  it("reads the caller's own notice", async () => {
    query.getNotice.mockResolvedValue({ pending: true });
    await expect(controller.getNotice(req)).resolves.toEqual({
      pending: true,
    });
    expect(query.getNotice).toHaveBeenCalledWith("u1");
  });

  it("acknowledges for the caller only", async () => {
    await controller.acknowledge(req, { version: "2026-10-17" });
    expect(service.acknowledge).toHaveBeenCalledWith("u1", "2026-10-17");
  });

  it("requires a JWT on both routes, and no impersonation to acknowledge", () => {
    const classGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      PrivacyPolicyController,
    ) as unknown[];
    const ackGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      PrivacyPolicyController.prototype.acknowledge,
    ) as unknown[];
    expect(classGuards).toContain(JwtAuthGuard);
    expect(ackGuards).toContain(NoImpersonationGuard);
  });

  it.each([
    ["a date", "2026-10-17", 0],
    ["free text", "latest", 1],
    ["a missing version", undefined, 1],
  ])("validates %s", async (_label, version, errors) => {
    const dto = plainToInstance(AcknowledgePrivacyPolicyDto, { version });
    expect(await validate(dto)).toHaveLength(errors);
  });
});
