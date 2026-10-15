import type { RegisterQueueOptions } from "@nestjs/bullmq";

export const FFD_SYNC_QUEUE = "ffd-sync";

/** Queue registration for the FFD competition sync (shared with tests). */
export const ffdSyncQueueOptions: RegisterQueueOptions = {
  name: FFD_SYNC_QUEUE,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
};
