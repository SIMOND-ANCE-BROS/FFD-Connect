import { StreamableFile } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import type { Response } from "express";
import { Readable } from "stream";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import {
  AdminLicenseRenewalsController,
  RENEWAL_DOCUMENT_HEADERS,
} from "./admin-license-renewals.controller";
import { LicenseRenewalModerationQueryService } from "./license-renewal-moderation.query-service";
import { LicenseRenewalModerationService } from "./license-renewal-moderation.service";

describe("AdminLicenseRenewalsController", () => {
  const query = {
    list: jest.fn(),
    detail: jest.fn(),
    openDocument: jest.fn(),
  };
  const moderation = { approve: jest.fn(), reject: jest.fn() };
  const controller = new AdminLicenseRenewalsController(
    query as unknown as LicenseRenewalModerationQueryService,
    moderation as unknown as LicenseRenewalModerationService,
  );
  const req = { user: { userId: "admin-1" } } as RequestWithUser;

  beforeEach(() => jest.resetAllMocks());

  it("is ADMIN-only at class level", () => {
    expect(
      new Reflector().get<UserRole[]>(
        ROLES_KEY,
        AdminLicenseRenewalsController,
      ),
    ).toEqual([UserRole.ADMIN]);
  });

  it("delegates list, detail, approve and reject with the caller id", async () => {
    query.list.mockResolvedValue("page");
    query.detail.mockResolvedValue("detail");
    moderation.approve.mockResolvedValue("approved");
    moderation.reject.mockResolvedValue("rejected");

    expect(await controller.list({ take: 5 })).toBe("page");
    expect(query.list).toHaveBeenCalledWith({ take: 5 });
    expect(await controller.detail("r1", req)).toBe("detail");
    expect(query.detail).toHaveBeenCalledWith("admin-1", "r1");
    expect(
      await controller.approve("r1", { licenseNumber: "FFD-1" }, req),
    ).toBe("approved");
    expect(moderation.approve).toHaveBeenCalledWith("admin-1", "r1", {
      licenseNumber: "FFD-1",
    });
    expect(await controller.reject("r1", { reason: "OTHER" }, req)).toBe(
      "rejected",
    );
    expect(moderation.reject).toHaveBeenCalledWith("admin-1", "r1", {
      reason: "OTHER",
    });
  });

  it("streams the document with no-store, inline, nosniff and a sandbox CSP", async () => {
    query.openDocument.mockResolvedValue({
      stream: Readable.from(["x"]),
      contentType: "image/png",
    });
    const res = { setHeader: jest.fn() };

    const file = await controller.documentFile(
      "r1",
      "d1",
      req,
      res as unknown as Response,
    );

    expect(query.openDocument).toHaveBeenCalledWith("admin-1", "r1", "d1");
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toEqual(
      expect.objectContaining({ type: "image/png", disposition: "inline" }),
    );
    expect(RENEWAL_DOCUMENT_HEADERS).toEqual({
      "Cache-Control": "no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    });
    for (const [name, value] of Object.entries(RENEWAL_DOCUMENT_HEADERS)) {
      expect(res.setHeader).toHaveBeenCalledWith(name, value);
    }
  });

  it("sets no header when the document cannot be opened", async () => {
    query.openDocument.mockRejectedValue(new Error("gone"));
    const res = { setHeader: jest.fn() };
    await expect(
      controller.documentFile("r1", "d1", req, res as unknown as Response),
    ).rejects.toThrow("gone");
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
