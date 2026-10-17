import { Logger } from "@nestjs/common";
import type { CompetitionEventNotificationService } from "./competition-event-notification.service";
import { ResultsNotificationScheduler } from "./results-notification.scheduler";

describe("ResultsNotificationScheduler (#713)", () => {
  let notifySettledResults: jest.Mock<Promise<number>, []>;
  let scheduler: ResultsNotificationScheduler;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    notifySettledResults = jest.fn().mockResolvedValue(0);
    scheduler = new ResultsNotificationScheduler({
      notifySettledResults,
    } as unknown as CompetitionEventNotificationService);
  });

  afterEach(() => jest.restoreAllMocks());

  it("runs a pass at boot (the app sleeps between requests)", async () => {
    scheduler.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    expect(notifySettledResults).toHaveBeenCalledTimes(1);
  });

  it("runs a pass on every cron tick and logs only when something was checked", async () => {
    await scheduler.handleCron();
    expect(Logger.prototype.log).not.toHaveBeenCalled();

    notifySettledResults.mockResolvedValue(2);
    await scheduler.handleCron();
    expect(notifySettledResults).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      "Pending results notifications (cron): 2 competition(s) checked",
    );
  });

  it("never overlaps two passes", async () => {
    let finish: (value: number) => void = () => undefined;
    notifySettledResults.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );

    const first = scheduler.runPass("cron");
    await scheduler.runPass("cron");
    finish(0);
    await first;

    expect(notifySettledResults).toHaveBeenCalledTimes(1);
    await scheduler.runPass("cron");
    expect(notifySettledResults).toHaveBeenCalledTimes(2);
  });

  it("swallows and logs a failed pass, then runs again", async () => {
    notifySettledResults.mockRejectedValueOnce(new Error("db down"));

    await expect(scheduler.runPass("cron")).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      "Pending results notifications pass failed: db down",
      expect.any(String),
    );

    await scheduler.runPass("cron");
    expect(notifySettledResults).toHaveBeenCalledTimes(2);
  });
});
