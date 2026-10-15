import { Test } from "@nestjs/testing";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { ParentalConsentController } from "./parental-consent.controller";
import { ParentalConsentQueryService } from "./parental-consent.query-service";
import { ParentalConsentService } from "./parental-consent.service";

describe("ParentalConsentController (#61)", () => {
  const service = {
    request: jest.fn(),
    confirm: jest.fn(),
    revoke: jest.fn(),
  };
  const query = { getState: jest.fn(), lookup: jest.fn() };
  let controller: ParentalConsentController;
  const req = { user: { userId: "u1" } } as unknown as RequestWithUser;
  const token = "a".repeat(64);

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ParentalConsentController],
      providers: [
        { provide: ParentalConsentService, useValue: service },
        { provide: ParentalConsentQueryService, useValue: query },
      ],
    })
      .overrideGuard(NoImpersonationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerUserGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ParentalConsentController);
  });

  it("reads the caller's own state", async () => {
    query.getState.mockResolvedValue({ state: "REQUIRED" });
    await expect(controller.getMine(req)).resolves.toEqual({
      state: "REQUIRED",
    });
    expect(query.getState).toHaveBeenCalledWith("u1");
  });

  it("requests for the caller only", async () => {
    service.request.mockResolvedValue({ state: "PENDING" });
    await controller.request(req, { parentEmail: "p@example.com" });
    expect(service.request).toHaveBeenCalledWith("u1", "p@example.com");
  });

  it("looks a link up, confirms and revokes with the token of the body", async () => {
    await controller.lookup({ token });
    expect(query.lookup).toHaveBeenCalledWith(token);

    await controller.confirm({
      token,
      acceptDataProcessing: true,
      acceptHealthData: true,
    });
    expect(service.confirm).toHaveBeenCalledWith(token);

    await controller.revoke({ token });
    expect(service.revoke).toHaveBeenCalledWith(token);
  });
});
