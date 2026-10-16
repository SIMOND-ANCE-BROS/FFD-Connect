import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { STORE_REVIEW_READABLE_KEY } from "../auth/store-review/store-review.decorator";
import { EntryQrController } from "./entry-qr.controller";
import { EntryQrQueryService } from "./entry-qr.query-service";

describe("EntryQrController", () => {
  const queryService = {
    getBatchForUser: jest.fn().mockResolvedValue({ keyId: "k" }),
    getKeySet: jest.fn().mockReturnValue({ keys: [] }),
  };
  const controller = new EntryQrController(
    queryService as unknown as EntryQrQueryService,
  );

  it("issues the batch of the authenticated user only", async () => {
    const req = { user: { userId: "user-1" } } as RequestWithUser;
    await expect(controller.getMyEntryQr(req)).resolves.toEqual({
      keyId: "k",
    });
    expect(queryService.getBatchForUser).toHaveBeenCalledWith("user-1");
  });

  it("requires a JWT and refuses impersonated sessions for the batch", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      EntryQrController.prototype.getMyEntryQr,
    ) as unknown[];
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, NoImpersonationGuard]),
    );
  });

  it("lets the store-review account read its own batch", () => {
    expect(
      Reflect.getMetadata(
        STORE_REVIEW_READABLE_KEY,
        EntryQrController.prototype.getMyEntryQr,
      ),
    ).toEqual({ ownData: true });
  });

  it("publishes the public keys without authentication", () => {
    expect(controller.getEntryQrKeys()).toEqual({ keys: [] });
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        EntryQrController.prototype.getEntryQrKeys,
      ),
    ).toBeUndefined();
  });
});
