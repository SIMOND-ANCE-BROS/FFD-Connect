import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { CompetitionSyncService } from "./services/competition-sync.service";
import { FFD_SYNC_QUEUE } from "./sync-queue.config";

export interface SyncResult {
  synced: number;
  failed: number;
}

@Processor(FFD_SYNC_QUEUE)
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private readonly syncService: CompetitionSyncService) {
    super();
  }

  async process(job: Job): Promise<SyncResult> {
    this.logger.log(`Starting FFD sync job ${job.id ?? ""}`);
    return this.syncService.syncFFDCompetitions();
  }
}
