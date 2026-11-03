import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { CguAcceptanceQueryService } from "./cgu-acceptance.query-service";
import { CguAcceptanceService } from "./cgu-acceptance.service";
import { CguController } from "./cgu.controller";
import { AcceptCguDto } from "./dto/cgu-acceptance.dto";

describe("CguController (#894)", () => {
  const query = { getAcceptance: jest.fn() };
  const service = { accept: jest.fn() };
  const req = { user: { userId: "u1" } } as unknown as RequestWithUser;
  let controller: CguController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [CguController],
      providers: [
        { provide: CguAcceptanceQueryService, useValue: query },
        { provide: CguAcceptanceService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(NoImpersonationGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(CguController);
  });

  it("reads the caller's own acceptance", async () => {
    query.getAcceptance.mockResolvedValue({ accepted: true });
    await expect(controller.getAcceptance(req)).resolves.toEqual({
      accepted: true,
    });
    expect(query.getAcceptance).toHaveBeenCalledWith("u1");
  });

  it("accepts for the caller only", async () => {
    await controller.accept(req, { version: "3" });
    expect(service.accept).toHaveBeenCalledWith("u1", "3");
  });

  it("requires a JWT on both routes, and no impersonation to accept", () => {
    const classGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      CguController,
    ) as unknown[];
    const acceptGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      CguController.prototype.accept,
    ) as unknown[];
    expect(classGuards).toContain(JwtAuthGuard);
    expect(acceptGuards).toContain(NoImpersonationGuard);
  });

  it.each([
    ["a version number", "3", 0],
    ["free text", "latest", 1],
    ["a number type", 3, 1],
    ["a missing version", undefined, 1],
  ])("validates %s", async (_label, version, errors) => {
    const dto = plainToInstance(AcceptCguDto, { version });
    expect(await validate(dto)).toHaveLength(errors);
  });
});
