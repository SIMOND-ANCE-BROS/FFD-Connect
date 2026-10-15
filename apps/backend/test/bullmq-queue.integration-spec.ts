/**
 * BullMQ against a REAL Redis (issue #36).
 *
 * Every other suite replaces the `ffd-sync` queue with a mock, so a Redis-layer
 * change (bullmq / ioredis bump, wire protocol) was never falsifiable by CI.
 * This suite boots the production queue wiring — `buildBullConnection` and
 * `ffdSyncQueueOptions`, the very objects AppModule and CompetitionsModule use
 * — with the real `SyncProcessor`, and only mocks the sync business logic.
 *
 * It enqueues jobs and lets the worker consume them, which exercises the
 * connection handshake, BullMQ's Lua scripts, stream-based QueueEvents and the
 * reply parsing of every queue call the app makes (`add`, `getJob`,
 * `getJobs`, `getJobCounts`, `getState`). It runs under the protocol the app
 * pins (REDIS_PROTOCOL) and under RESP3 (ioredis 6's default), so dropping the
 * pin is a one-line change whose queue behaviour is already proven.
 *
 * Needs a Redis on REDIS_HOST:REDIS_PORT (CI: the `redis:7` service of the
 * backend-test job; locally: `docker compose --profile infra up -d`). It does
 * not touch the database.
 */
import { BullModule, getQueueToken } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { Queue, QueueEvents, type RedisOptions } from "bullmq";
import { randomUUID } from "crypto";
import { CompetitionSyncService } from "../src/competitions/services/competition-sync.service";
import {
  FFD_SYNC_QUEUE,
  ffdSyncQueueOptions,
} from "../src/competitions/sync-queue.config";
import { SyncProcessor, SyncResult } from "../src/competitions/sync.processor";
import {
  REDIS_PROTOCOL,
  buildBullConnection,
} from "../src/redis/bullmq-connection";

const FINISH_TIMEOUT_MS = 15_000;

describe.each([
  { label: "pinned protocol (REDIS_PROTOCOL)", protocol: REDIS_PROTOCOL },
  { label: "RESP3 (ioredis 6 default)", protocol: 3 },
])("BullMQ ffd-sync queue on a real Redis — $label", ({ protocol }) => {
  let moduleRef: TestingModule;
  let queue: Queue;
  let queueEvents: QueueEvents;
  const syncFFDCompetitions = jest.fn<Promise<SyncResult>, []>();

  beforeAll(async () => {
    // A per-run prefix keeps these keys apart from anything else on the
    // server and lets afterAll remove everything this suite wrote.
    const prefix = `test-bullmq-${randomUUID()}`;
    let connection: RedisOptions = {};

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        BullModule.forRootAsync({
          useFactory: (configService: ConfigService) => {
            const base = buildBullConnection(configService);
            connection = { ...base.connection, protocol };
            return { connection, prefix };
          },
          inject: [ConfigService],
        }),
        BullModule.registerQueue(ffdSyncQueueOptions),
      ],
      providers: [
        SyncProcessor,
        {
          provide: CompetitionSyncService,
          useValue: { syncFFDCompetitions },
        },
      ],
    }).compile();

    await moduleRef.init();

    queue = moduleRef.get<Queue>(getQueueToken(FFD_SYNC_QUEUE));
    queueEvents = new QueueEvents(FFD_SYNC_QUEUE, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(() => {
    syncFFDCompetitions.mockReset();
  });

  afterAll(async () => {
    await queueEvents.close();
    await queue.obliterate({ force: true });
    await moduleRef.close();
  });

  it("runs a worker whose connection negotiated the requested protocol", async () => {
    // CLIENT LIST as seen by BullMQ: the SyncProcessor worker's own ioredis
    // connection, with the `resp` field Redis reports for it.
    const workers = await queue.getWorkers();
    expect(workers.length).toBeGreaterThanOrEqual(1);
    for (const worker of workers) {
      expect(worker.resp).toBe(String(protocol));
    }
  });

  it("processes an enqueued sync job to completion", async () => {
    syncFFDCompetitions.mockResolvedValue({ synced: 3, failed: 1 });

    const job = await queue.add("sync-ffd", {});
    expect(job.id).toBeDefined();

    await expect(
      job.waitUntilFinished(queueEvents, FINISH_TIMEOUT_MS),
    ).resolves.toEqual({ synced: 3, failed: 1 });
    expect(syncFFDCompetitions).toHaveBeenCalledTimes(1);

    // The read path of CompetitionManagementService.getSyncStatus.
    const stored = await queue.getJob(job.id!);
    expect(stored).toBeDefined();
    await expect(stored!.getState()).resolves.toBe("completed");
    expect(stored!.returnvalue).toEqual({ synced: 3, failed: 1 });

    // The "sync already in progress" guard of triggerSync.
    await expect(
      queue.getJobs(["active", "waiting", "delayed"]),
    ).resolves.toHaveLength(0);

    // The queue health check (HealthService.checkQueues).
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "failed",
      "delayed",
      "completed",
    );
    expect(counts).toEqual(
      expect.objectContaining({
        waiting: 0,
        active: 0,
        delayed: 0,
        completed: expect.any(Number) as number,
      }),
    );
    expect(counts.completed).toBeGreaterThanOrEqual(1);
  });

  it("records a failed sync with its reason", async () => {
    syncFFDCompetitions.mockRejectedValue(new Error("FFD site unreachable"));

    // One attempt: the production backoff (3 attempts, 5 s exponential)
    // would only slow the test without exercising anything else.
    const job = await queue.add("sync-ffd", {}, { attempts: 1 });

    await expect(
      job.waitUntilFinished(queueEvents, FINISH_TIMEOUT_MS),
    ).rejects.toThrow("FFD site unreachable");

    const stored = await queue.getJob(job.id!);
    await expect(stored!.getState()).resolves.toBe("failed");
    expect(stored!.failedReason).toBe("FFD site unreachable");

    const { failed } = await queue.getJobCounts("failed");
    expect(failed).toBeGreaterThanOrEqual(1);
  });

  it("applies the production default job options", async () => {
    syncFFDCompetitions.mockResolvedValue({ synced: 0, failed: 0 });

    const job = await queue.add("sync-ffd", {});
    await job.waitUntilFinished(queueEvents, FINISH_TIMEOUT_MS);

    const stored = await queue.getJob(job.id!);
    expect(stored!.opts.attempts).toBe(3);
    expect(stored!.opts.backoff).toEqual({ type: "exponential", delay: 5000 });
  });
});
