import { Logger } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { idOnlySelect } from "../utils/prisma-selects";
import { ImpersonationActionLogService } from "./impersonation-action-log.service";

describe("ImpersonationActionLogService (#761)", () => {
  const create = jest.fn();
  const service = new ImpersonationActionLogService({
    impersonationActionLog: { create },
  } as unknown as PrismaService);
  const entry = {
    impersonationLogId: "log-1",
    method: "PATCH",
    route: "/clubs/me/registration-mode",
    statusCode: 403,
  };

  beforeEach(() => {
    create.mockReset();
  });

  it("writes the entry as is, reading back the id only", async () => {
    create.mockResolvedValue({ id: "a-1" });
    await service.record(entry);
    expect(create).toHaveBeenCalledWith({ data: entry, select: idOnlySelect });
  });

  it("never throws: a failed write is logged as an error", async () => {
    const logged = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    create.mockRejectedValue(new Error("FK violation"));

    await expect(service.record(entry)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(
        "PATCH /clubs/me/registration-mode → 403, session log-1): FK violation",
      ),
    );

    create.mockRejectedValue("boom");
    await expect(service.record(entry)).resolves.toBeUndefined();
    expect(logged).toHaveBeenLastCalledWith(expect.stringContaining("boom"));
    logged.mockRestore();
  });
});
