import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { UsageEventDto } from "./dto/usage-event.dto";
import { UsageIntakeService } from "./usage-intake.service";

const NOW = new Date("2026-10-10T10:00:00.000Z");
const dto = (o: Partial<UsageEventDto> = {}): UsageEventDto => ({
  installId: "4b0f8a2e-1c3d-4e5f-9a6b-7c8d9e0f1a2b",
  name: "screen_view",
  occurredAt: "2026-10-10T09:59:00.000Z",
  platform: "android",
  appVersion: "1.4.2",
  space: "GUEST",
  ...o,
});

describe("UsageIntakeService", () => {
  const createMany = jest.fn().mockResolvedValue({ count: 1 });
  const service = new UsageIntakeService({
    usageEvent: { createMany },
  } as unknown as PrismaService);

  beforeEach(() => createMany.mockClear());

  it("writes every event, optional fields as null", async () => {
    await expect(
      service.ingest([dto({ screen: "Home", durationSec: 3 })], NOW),
    ).resolves.toBe(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          installId: "4b0f8a2e-1c3d-4e5f-9a6b-7c8d9e0f1a2b",
          name: "screen_view",
          screen: "Home",
          occurredAt: new Date("2026-10-10T09:59:00.000Z"),
          platform: "android",
          appVersion: "1.4.2",
          space: "GUEST",
          competitionId: null,
          durationSec: 3,
        },
      ],
    });
  });

  it.each([
    ["older than 7 days", "2026-10-03T09:59:00.000Z"],
    ["more than 5 minutes ahead", "2026-10-10T10:05:01.000Z"],
  ])(
    "rejects the whole batch when one event is %s",
    async (_label, occurredAt) => {
      await expect(
        service.ingest([dto(), dto({ occurredAt })], NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMany).not.toHaveBeenCalled();
    },
  );

  it("accepts the window edges", async () => {
    await service.ingest(
      [
        dto({ occurredAt: "2026-10-03T10:00:00.000Z" }),
        dto({ occurredAt: "2026-10-10T10:05:00.000Z" }),
      ],
      NOW,
    );
    expect(createMany).toHaveBeenCalled();
  });
});
