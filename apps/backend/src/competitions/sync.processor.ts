import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { CompetitionSyncService } from "./services/competition-sync.service";

export interface SyncResult {
  synced: number;
  failed: number;
}

@Processor("ffd-sync")
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
