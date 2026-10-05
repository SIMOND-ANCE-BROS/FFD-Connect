import { Job } from "bullmq";
import { CompetitionSyncService } from "./services/competition-sync.service";
import { SyncProcessor } from "./sync.processor";

const makeSyncService = () => ({
  syncFFDCompetitions: jest.fn().mockResolvedValue({
    synced: 4,
    failed: 0,
  }),
});

describe("SyncProcessor", () => {
  let processor: SyncProcessor;
  let syncService: ReturnType<typeof makeSyncService>;

  beforeEach(() => {
    syncService = makeSyncService();
    processor = new SyncProcessor(
      syncService as unknown as CompetitionSyncService,
    );
  });

  it("calls syncFFDCompetitions and returns the result", async () => {
    const job = { id: "job-1" } as Partial<Job>;

    const result = await processor.process(job as Job);

    expect(syncService.syncFFDCompetitions).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      synced: 4,
      failed: 0,
    });
  });

  it("propagates errors from syncFFDCompetitions", async () => {
    syncService.syncFFDCompetitions.mockRejectedValue(
      new Error("FFD API down"),
    );
    const job = { id: "job-2" } as Partial<Job>;

    await expect(processor.process(job as Job)).rejects.toThrow("FFD API down");
  });
});
