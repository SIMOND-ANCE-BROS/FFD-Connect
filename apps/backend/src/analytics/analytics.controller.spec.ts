import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AnalyticsController } from "./analytics.controller";
import type { UsageIntakeService } from "./usage-intake.service";

describe("AnalyticsController", () => {
  it("has no auth guard and a 10/min throttle on ingest", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AnalyticsController),
    ).toBeUndefined();
    const handler = AnalyticsController.prototype.ingest;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
    expect(Reflect.getMetadata("THROTTLER:LIMITdefault", handler)).toBe(10);
    expect(Reflect.getMetadata("THROTTLER:TTLdefault", handler)).toBe(60_000);
  });

  it("hands the events to the intake service", async () => {
    const ingest = jest.fn().mockResolvedValue(1);
    const controller = new AnalyticsController({
      ingest,
    } as unknown as UsageIntakeService);
    const events = [{ name: "login" }];
    await controller.ingest({ events } as never);
    expect(ingest).toHaveBeenCalledWith(events);
  });
});
