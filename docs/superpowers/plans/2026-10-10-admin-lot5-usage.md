# Admin back-office lot 5 — anonymous app usage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile app records anonymous usage events and sends them in batches only while the backend is already awake; the backend stores, aggregates and purges them; the admin SPA shows a « Usage de l'app » page with a « jour × heure » grid.

**Architecture:** Client: a storage-backed `usageRecorder` (monthly random install ID, 500-event buffer, flush after a successful API response or on background) behind the existing `analytics` service. Backend: a public, throttled `POST /analytics/events` writing `UsageEvent`; an hourly + boot `UsageRetentionService` rolling finished Paris days into `UsageDaily` / `UsageDailyActive` and purging; `GET /admin/usage` reading raw events (7d/30d) or aggregates (12m). SPA: lazy `/usage` page.

**Tech Stack:** NestJS 11, Prisma 7 / PostgreSQL 15, Jest; React Native / Expo (jest-expo); React 19 + Mantine 8 + `@mantine/charts`, TanStack Query 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-admin-lot5-usage-design.md`

## Global Constraints

- **Prerequisite:** PR #243 (lot 4) merged into `develop`. Task 1 Step 0 rebases this branch on it; lot 4's `apps/backend/src/admin/stats/stats-period.ts`, `apps/admin/src/lib/stats.ts` and `@mantine/charts` must exist.
- Worktree `/Users/gabin/Development/FFD-Connect-lot5`, branch `feature/admin-lot5-usage`. Never commit to `develop`.
- Event names (client union = backend constant): `login`, `login_biometric`, `login_guest`, `screen_view`, `competition_view`, `license_scan`, `register`, `registration_start`, `license_wallet_add`.
- Spaces: `LICENSEE`, `CLUB`, `STAFF`, `ADMIN`, `GUEST`. Platforms: `ios`, `android`.
- Limits: batch 1–200 events; buffer 500 events (drop oldest); `durationSec` integer 0–1 800; `occurredAt` within the last 7 days and at most 5 minutes ahead; flush at most every 2 minutes after a successful API response; background flush only if an API response succeeded within the last 5 minutes.
- Throttle `POST /analytics/events`: 10 requests / 60 000 ms per IP. Response 204. Invalid batch → 400, nothing stored.
- Retention: `UsageEvent` 90 days (never before its day is aggregated); `UsageDaily` / `UsageDailyActive` 25 months.
- Session = run of events of one install with gaps under 30 minutes.
- `GET /admin/usage?period=7d|30d|12m&space=` ADMIN-only (class-level guards), default `30d`; other values → 400.
- No request may wake the backend: the batch send never goes through `wakeBackend`, never on a timer, never at launch alone. No `Authorization` header on the batch.
- IP and User-Agent never stored; the request body never logged.
- Additive migration only. No `any`. No `process.env` in the backend. `take` / `LIMIT` on every unbounded read; every aggregate read bounded on both sides.
- SQL identifiers only as code constants; values as bound parameters.
- Copy (French, verbatim): menu « Usage de l'app »; periods « 7 jours », « 30 jours », « 12 mois »; space filter « Tous », « Licencié », « Club », « Staff », « Admin », « Invité »; figures « Installations actives / jour », « Installations actives ce mois », « Sessions », « Durée médiane d'une session », « iOS / Android »; empty « Aucune donnée d'usage sur la période. »; « Compétition supprimée »; 12m notes « Données agrégées jusqu'au <JJ/MM/AAAA> » and « 90 derniers jours »; footer « Données anonymes : un identifiant d'installation renouvelé chaque mois, sans lien avec les comptes. Les utilisateurs qui ont désactivé la mesure d'audience n'apparaissent pas. »; settings switch « Mesure d'audience anonyme » with « Statistiques d'usage anonymes, sans lien avec votre compte. »
- Code style: backend and client double quotes; admin SPA single quotes.
- Real-DB tests only on `ffd_connect_admin_test`, with this env (no real API keys) — called « test-DB env » below:
  ```bash
  source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh
  export JWT_SECRET="test-secret-key-for-ci-min-32-chars!!" NODE_ENV=test
  ```
  Schema sync on that DB: `npx prisma db push`. Never touch the shared `ffd_connect` DB.
- Swagger regeneration: `DATABASE_URL=postgresql://localhost/dummy JWT_SECRET=test-secret-key-for-swagger-export-only pnpm api:sync`.
- Commits: conventional, English, ending with
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv
  ```

## Review Focus

1. **Backend asleep** — after the app has been idle, a screen view must never trigger a request by itself; the first batch goes out only after another API call succeeded (Task 5 tests `onApiSuccess` gating; Task 6 wires both HTTP clients).
2. **Account linkage leak** — the batch request must carry no `Authorization` header and the server must not read the JWT on that route (Task 6 test on headers; Task 1 controller has no guard).
3. **Rollup re-run** — the hourly job and the boot pass can both run; re-aggregating a day must not double counts (Task 3 idempotence test on the real DB).
4. **Purge before rollup** — raw events of a day not yet aggregated must never be purged, even if older than 90 days after downtime (Task 3 unit test with `lastDay` behind).
5. **Empty period** — no events: zero-filled series, `null` median, empty tables, « Aucune donnée d'usage sur la période. » (Task 4 unit, Task 8 SPA test).

---

### Task 1: Schema, migration, intake endpoint

**Files:**

- Create: `apps/backend/prisma/schema/usage.prisma`
- Create: `apps/backend/prisma/schema/migrations/20261011090000_usage_analytics/migration.sql`
- Create: `apps/backend/src/analytics/usage.constants.ts`
- Create: `apps/backend/src/analytics/dto/usage-event.dto.ts`
- Create: `apps/backend/src/analytics/usage-intake.service.ts`
- Create: `apps/backend/src/analytics/analytics.controller.ts`
- Create: `apps/backend/src/analytics/analytics.module.ts`
- Modify: `apps/backend/src/app.module.ts` (import `AnalyticsModule`)
- Test: `apps/backend/src/analytics/usage.constants.spec.ts`, `apps/backend/src/analytics/dto/usage-event.dto.spec.ts`, `apps/backend/src/analytics/usage-intake.service.spec.ts`, `apps/backend/src/analytics/analytics.controller.spec.ts`, `apps/backend/test/analytics.e2e-spec.ts`

**Interfaces:**

- Produces:
  - Prisma models `UsageEvent`, `UsageDaily`, `UsageDailyActive` (key `day_platform`), `UsageRollupState`.
  - `USAGE_EVENT_NAMES`, `USAGE_KEY_EVENTS`, `USAGE_SPACES`, `USAGE_PLATFORMS`, `USAGE_MAX_BATCH = 200`, `USAGE_MAX_DURATION_SEC = 1800`, `USAGE_PAST_WINDOW_MS = 7 * 86_400_000`, `USAGE_FUTURE_SKEW_MS = 300_000`, `USAGE_RAW_RETENTION_DAYS = 90`, `USAGE_AGG_RETENTION_MONTHS = 25`, `USAGE_SESSION_GAP_MINUTES = 30`; types `UsageEventName`, `UsageSpace`, `UsagePlatform`.
  - `UsageEventDto`, `UsageBatchDto { events: UsageEventDto[] }`.
  - `UsageIntakeService.ingest(events: UsageEventDto[], now?: Date): Promise<number>` (rows written).
  - Route `POST /api/v1/analytics/events` → 204.

- [ ] **Step 0: Rebase on develop with lot 4, install**

```bash
cd /Users/gabin/Development/FFD-Connect-lot5
git fetch origin develop
git log origin/develop --oneline --grep='lot 4 — database stats' -1 | grep . || { echo "PR #243 not merged yet — stop"; exit 1; }
git rebase origin/develop
pnpm install --frozen-lockfile && pnpm --filter backend exec prisma generate
test -f apps/backend/src/admin/stats/stats-period.ts && test -f apps/admin/src/lib/stats.ts && echo "lot 4 present"
```

Expected: « lot 4 present ». If #243 is not merged, stop and report: merging it is the user's decision.

- [ ] **Step 1: Write the schema**

```prisma
// apps/backend/prisma/schema/usage.prisma
/// Mesure d'audience anonyme de l'application (lot 5). Aucun lien avec un
/// compte : `installId` est un UUID tiré sur l'appareil et renouvelé chaque
/// mois ; la route d'ingestion n'est pas authentifiée. Purge à 90 jours,
/// jamais avant l'agrégation du jour (UsageRetentionService).
model UsageEvent {
  id            String   @id @default(uuid())
  installId     String
  name          String
  screen        String?
  occurredAt    DateTime
  platform      String
  appVersion    String
  space         String
  /// Pas de clé étrangère : une compétition supprimée ne casse rien.
  competitionId String?
  durationSec   Int?
  receivedAt    DateTime @default(now())

  @@index([occurredAt])
  @@index([installId, occurredAt])
}

/// Agrégat par jour et heure de Paris, sans identifiant. Conservé 25 mois.
model UsageDaily {
  day         DateTime @db.Date
  hour        Int
  name        String
  screen      String   @default("")
  platform    String
  appVersion  String
  space       String
  count       Int
  durationSec Int      @default(0)

  @@id([day, hour, name, screen, platform, appVersion, space])
  @@index([day])
}

/// Installations distinctes par jour de Paris et plateforme (une installation
/// n'a qu'une plateforme : la somme des plateformes est exacte). 25 mois.
model UsageDailyActive {
  day      DateTime @db.Date
  platform String
  installs Int

  @@id([day, platform])
}

/// Dernier jour de Paris entièrement agrégé (ligne unique, id = 1).
model UsageRollupState {
  id      Int      @id @default(1)
  lastDay DateTime @db.Date
}
```

- [ ] **Step 2: Write the migration and check it matches the schema**

```sql
-- apps/backend/prisma/schema/migrations/20261011090000_usage_analytics/migration.sql
-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "screen" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "competitionId" TEXT,
    "durationSec" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageDaily" (
    "day" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "screen" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageDaily_pkey" PRIMARY KEY ("day","hour","name","screen","platform","appVersion","space")
);

-- CreateTable
CREATE TABLE "UsageDailyActive" (
    "day" DATE NOT NULL,
    "platform" TEXT NOT NULL,
    "installs" INTEGER NOT NULL,

    CONSTRAINT "UsageDailyActive_pkey" PRIMARY KEY ("day","platform")
);

-- CreateTable
CREATE TABLE "UsageRollupState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastDay" DATE NOT NULL,

    CONSTRAINT "UsageRollupState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageEvent_occurredAt_idx" ON "UsageEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "UsageEvent_installId_occurredAt_idx" ON "UsageEvent"("installId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageDaily_day_idx" ON "UsageDaily"("day");
```

Check against Prisma's own diff (old schema from `origin/develop`):

```bash
cd /Users/gabin/Development/FFD-Connect-lot5/apps/backend
OLD=$(mktemp -d) && git archive origin/develop prisma/schema | tar -x -C "$OLD"
npx prisma validate
npx prisma migrate diff --from-schema "$OLD/prisma/schema" --to-schema prisma/schema --script > "$OLD/diff.sql"
diff <(grep -vE '^\s*$|^--' "$OLD/diff.sql") <(grep -vE '^\s*$|^--' prisma/schema/migrations/20261011090000_usage_analytics/migration.sql) && echo "migration matches schema"
npx prisma generate
```

Expected: « migration matches schema ». If the CLI's flag names differ, read `npx prisma migrate diff --help` and keep the same comparison. Any non-whitespace difference: correct the SQL file to Prisma's output.

- [ ] **Step 3: Write the failing tests**

```ts
// apps/backend/src/analytics/usage.constants.spec.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { USAGE_EVENT_NAMES } from './usage.constants';

describe('usage constants', () => {
  it("mirrors the client's AnalyticsEventName union exactly", () => {
    const types = readFileSync(
      join(__dirname, '../../../client/src/services/analytics/types.ts'),
      'utf8',
    );
    const union = /export type AnalyticsEventName =([^;]+);/.exec(types);
    expect(union).not.toBeNull();
    const names = [...(union?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...names].sort()).toEqual([...USAGE_EVENT_NAMES].sort());
  });
});
```

```ts
// apps/backend/src/analytics/dto/usage-event.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsageBatchDto } from './usage-event.dto';

const event = (o: Record<string, unknown> = {}) => ({
  installId: '4b0f8a2e-1c3d-4e5f-9a6b-7c8d9e0f1a2b',
  name: 'screen_view',
  screen: 'CompetitionDetail',
  occurredAt: '2026-10-10T08:15:00.000Z',
  platform: 'ios',
  appVersion: '1.4.2',
  space: 'LICENSEE',
  competitionId: '00000000-0000-4000-8000-000000000000',
  durationSec: 42,
  ...o,
});

const errorsFor = async (body: unknown) =>
  validate(plainToInstance(UsageBatchDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('UsageBatchDto', () => {
  it('accepts a valid batch, optional fields absent', async () => {
    const minimal: Record<string, unknown> = event();
    delete minimal.screen;
    delete minimal.competitionId;
    delete minimal.durationSec;
    expect(await errorsFor({ events: [event(), minimal] })).toHaveLength(0);
  });

  it.each([
    ['installId', 'not-a-uuid'],
    ['installId', '4b0f8a2e-1c3d-1e5f-9a6b-7c8d9e0f1a2b'], // v1, not v4
    ['name', 'purchase'],
    ['screen', 'Bad Screen!'],
    ['screen', 'x'.repeat(65)],
    ['occurredAt', 'yesterday'],
    ['platform', 'web'],
    ['appVersion', '1.4.2 beta'],
    ['appVersion', '1'.repeat(21)],
    ['space', 'SUPERADMIN'],
    ['competitionId', '42'],
    ['durationSec', -1],
    ['durationSec', 1801],
    ['durationSec', 1.5],
  ])('rejects %s = %p', async (field, value) => {
    const errors = await errorsFor({ events: [event({ [field]: value })] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an unknown property', async () => {
    const errors = await errorsFor({ events: [event({ userId: 'u1' })] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects 0 and 201 events', async () => {
    expect((await errorsFor({ events: [] })).length).toBeGreaterThan(0);
    const many = Array.from({ length: 201 }, () => event());
    expect((await errorsFor({ events: many })).length).toBeGreaterThan(0);
  });
});
```

```ts
// apps/backend/src/analytics/usage-intake.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsageEventDto } from './dto/usage-event.dto';
import { UsageIntakeService } from './usage-intake.service';

const NOW = new Date('2026-10-10T10:00:00.000Z');
const dto = (o: Partial<UsageEventDto> = {}): UsageEventDto => ({
  installId: '4b0f8a2e-1c3d-4e5f-9a6b-7c8d9e0f1a2b',
  name: 'screen_view',
  occurredAt: '2026-10-10T09:59:00.000Z',
  platform: 'android',
  appVersion: '1.4.2',
  space: 'GUEST',
  ...o,
});

describe('UsageIntakeService', () => {
  const createMany = jest.fn().mockResolvedValue({ count: 1 });
  const service = new UsageIntakeService({
    usageEvent: { createMany },
  } as unknown as PrismaService);

  beforeEach(() => createMany.mockClear());

  it('writes every event, optional fields as null', async () => {
    await expect(service.ingest([dto({ screen: 'Home', durationSec: 3 })], NOW)).resolves.toBe(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          installId: '4b0f8a2e-1c3d-4e5f-9a6b-7c8d9e0f1a2b',
          name: 'screen_view',
          screen: 'Home',
          occurredAt: new Date('2026-10-10T09:59:00.000Z'),
          platform: 'android',
          appVersion: '1.4.2',
          space: 'GUEST',
          competitionId: null,
          durationSec: 3,
        },
      ],
    });
  });

  it.each([
    ['older than 7 days', '2026-10-03T09:59:00.000Z'],
    ['more than 5 minutes ahead', '2026-10-10T10:05:01.000Z'],
  ])('rejects the whole batch when one event is %s', async (_label, occurredAt) => {
    await expect(service.ingest([dto(), dto({ occurredAt })], NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(createMany).not.toHaveBeenCalled();
  });

  it('accepts the window edges', async () => {
    await service.ingest(
      [
        dto({ occurredAt: '2026-10-03T10:00:00.000Z' }),
        dto({ occurredAt: '2026-10-10T10:05:00.000Z' }),
      ],
      NOW,
    );
    expect(createMany).toHaveBeenCalled();
  });
});
```

```ts
// apps/backend/src/analytics/analytics.controller.spec.ts
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AnalyticsController } from './analytics.controller';
import type { UsageIntakeService } from './usage-intake.service';

describe('AnalyticsController', () => {
  it('has no auth guard and a 10/min throttle on ingest', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AnalyticsController)).toBeUndefined();
    const handler = AnalyticsController.prototype.ingest;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });

  it('hands the events to the intake service', async () => {
    const ingest = jest.fn().mockResolvedValue(1);
    const controller = new AnalyticsController({
      ingest,
    } as unknown as UsageIntakeService);
    const events = [{ name: 'login' }];
    await controller.ingest({ events } as never);
    expect(ingest).toHaveBeenCalledWith(events);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm --filter backend exec jest src/analytics`
Expected: FAIL, cannot find `./usage.constants`, `./usage-event.dto`, `./usage-intake.service`, `./analytics.controller`.

- [ ] **Step 5: Implement**

```ts
// apps/backend/src/analytics/usage.constants.ts
/**
 * Mesure d'audience anonyme (lot 5). Les noms d'événements sont le miroir
 * exact de `AnalyticsEventName` côté client (vérifié par usage.constants.spec).
 */
export const USAGE_EVENT_NAMES = [
  'login',
  'login_biometric',
  'login_guest',
  'screen_view',
  'competition_view',
  'license_scan',
  'register',
  'registration_start',
  'license_wallet_add',
] as const;
export type UsageEventName = (typeof USAGE_EVENT_NAMES)[number];

/** Events shown per day on the dashboard (screen views have their own table). */
export const USAGE_KEY_EVENTS = [
  'login',
  'login_biometric',
  'login_guest',
  'register',
  'license_scan',
  'license_wallet_add',
] as const satisfies readonly UsageEventName[];

export const USAGE_SPACES = ['LICENSEE', 'CLUB', 'STAFF', 'ADMIN', 'GUEST'] as const;
export type UsageSpace = (typeof USAGE_SPACES)[number];

export const USAGE_PLATFORMS = ['ios', 'android'] as const;
export type UsagePlatform = (typeof USAGE_PLATFORMS)[number];

export const USAGE_MAX_BATCH = 200;
export const USAGE_MAX_DURATION_SEC = 1800;
export const USAGE_PAST_WINDOW_MS = 7 * 86_400_000;
export const USAGE_FUTURE_SKEW_MS = 5 * 60_000;
export const USAGE_RAW_RETENTION_DAYS = 90;
export const USAGE_AGG_RETENTION_MONTHS = 25;
export const USAGE_SESSION_GAP_MINUTES = 30;
```

```ts
// apps/backend/src/analytics/dto/usage-event.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  USAGE_EVENT_NAMES,
  USAGE_MAX_BATCH,
  USAGE_MAX_DURATION_SEC,
  USAGE_PLATFORMS,
  USAGE_SPACES,
  type UsageEventName,
  type UsagePlatform,
  type UsageSpace,
} from '../usage.constants';

export class UsageEventDto {
  @ApiProperty({ description: 'Random install ID (UUID v4), renewed monthly' })
  @IsUUID('4')
  installId!: string;

  @ApiProperty({ enum: USAGE_EVENT_NAMES })
  @IsIn(USAGE_EVENT_NAMES)
  name!: UsageEventName;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_]+$/)
  screen?: string;

  @ApiProperty({ description: 'ISO date, truncated to the minute by the app' })
  @IsISO8601({ strict: true })
  occurredAt!: string;

  @ApiProperty({ enum: USAGE_PLATFORMS })
  @IsIn(USAGE_PLATFORMS)
  platform!: UsagePlatform;

  @ApiProperty({ maxLength: 20 })
  @MaxLength(20)
  @Matches(/^[0-9A-Za-z.-]+$/)
  appVersion!: string;

  @ApiProperty({ enum: USAGE_SPACES })
  @IsIn(USAGE_SPACES)
  space!: UsageSpace;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  competitionId?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: USAGE_MAX_DURATION_SEC })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(USAGE_MAX_DURATION_SEC)
  durationSec?: number;
}

export class UsageBatchDto {
  @ApiProperty({ type: [UsageEventDto], minItems: 1, maxItems: USAGE_MAX_BATCH })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(USAGE_MAX_BATCH)
  @ValidateNested({ each: true })
  @Type(() => UsageEventDto)
  events!: UsageEventDto[];
}
```

```ts
// apps/backend/src/analytics/usage-intake.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UsageEventDto } from './dto/usage-event.dto';
import { USAGE_FUTURE_SKEW_MS, USAGE_PAST_WINDOW_MS } from './usage.constants';

/** Stores anonymous usage batches. Never reads the request (IP, User-Agent). */
@Injectable()
export class UsageIntakeService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(events: UsageEventDto[], now: Date = new Date()): Promise<number> {
    const min = now.getTime() - USAGE_PAST_WINDOW_MS;
    const max = now.getTime() + USAGE_FUTURE_SKEW_MS;
    const times = events.map((e) => Date.parse(e.occurredAt));
    if (times.some((t) => !(t >= min && t <= max))) {
      throw new BadRequestException('occurredAt outside the accepted window');
    }
    const { count } = await this.prisma.usageEvent.createMany({
      data: events.map((e, i) => ({
        installId: e.installId,
        name: e.name,
        screen: e.screen ?? null,
        occurredAt: new Date(times[i]),
        platform: e.platform,
        appVersion: e.appVersion,
        space: e.space,
        competitionId: e.competitionId ?? null,
        durationSec: e.durationSec ?? null,
      })),
    });
    return count;
  }
}
```

```ts
// apps/backend/src/analytics/analytics.controller.ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiCommonErrorResponses } from '../common/decorators/api-error-responses.decorator';
import { UsageBatchDto } from './dto/usage-event.dto';
import { UsageIntakeService } from './usage-intake.service';

/**
 * Anonymous usage intake (lot 5). Deliberately WITHOUT auth guard: no event
 * can be tied to an account. The app sends only while the backend is awake.
 */
@ApiTags('analytics')
@ApiCommonErrorResponses()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly intake: UsageIntakeService) {}

  @Post('events')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Anonymous app usage events (batch, no auth)' })
  @ApiResponse({ status: 204, description: 'Stored' })
  async ingest(@Body() body: UsageBatchDto): Promise<void> {
    await this.intake.ingest(body.events);
  }
}
```

```ts
// apps/backend/src/analytics/analytics.module.ts
import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { UsageIntakeService } from './usage-intake.service';

@Module({
  controllers: [AnalyticsController],
  providers: [UsageIntakeService],
})
export class AnalyticsModule {}
```

In `apps/backend/src/app.module.ts`, import `AnalyticsModule` and add it to `imports` next to `AdminModule`. If `PrismaService` is not provided globally (check `src/prisma/prisma.module.ts` for `@Global()`), add `PrismaModule` to `AnalyticsModule.imports`.

- [ ] **Step 6: Run unit tests**

Run: `pnpm --filter backend exec jest src/analytics`
Expected: PASS.

- [ ] **Step 7: E2E — public intake and 400**

```ts
// apps/backend/test/analytics.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { createMockPrismaService } from './mocks/prisma.mock';
import { applyE2EOverrides, configureTestApp } from './test-app.factory';

const event = () => ({
  installId: '4b0f8a2e-1c3d-4e5f-9a6b-7c8d9e0f1a2b',
  name: 'login',
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  platform: 'ios',
  appVersion: '1.4.2',
  space: 'GUEST',
});

describe('Analytics intake (e2e)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeAll(async () => {
    prisma = createMockPrismaService();
    const moduleRef = await applyE2EOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(RedisService)
        .useValue({
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
          deleteByPattern: jest.fn().mockResolvedValue(undefined),
          keys: jest.fn().mockResolvedValue([]),
          exists: jest.fn().mockResolvedValue(false),
          isAvailable: jest.fn().mockReturnValue(false),
          getClient: jest.fn().mockReturnValue(null),
          onModuleDestroy: jest.fn(),
        }),
    ).compile();
    app = moduleRef.createNestApplication();
    await configureTestApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  it('accepts a batch without any token (204)', async () => {
    prisma.usageEvent.createMany.mockResolvedValue({ count: 1 } as never);
    await request(server())
      .post('/api/v1/analytics/events')
      .send({ events: [event()] })
      .expect(204);
    expect(prisma.usageEvent.createMany).toHaveBeenCalled();
  });

  it('rejects an invalid batch with 400 and stores nothing', async () => {
    prisma.usageEvent.createMany.mockClear();
    await request(server())
      .post('/api/v1/analytics/events')
      .send({ events: [{ ...event(), name: 'purchase' }] })
      .expect(400);
    expect(prisma.usageEvent.createMany).not.toHaveBeenCalled();
  });
});
```

Run (the e2e global setup runs `db push` on `DATABASE_URL`, so use the test-DB env): `cd apps/backend && <test-DB env> && pnpm test:e2e -- test/analytics.e2e-spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/prisma/schema/usage.prisma apps/backend/prisma/schema/migrations/20261011090000_usage_analytics apps/backend/src/analytics apps/backend/src/app.module.ts apps/backend/test/analytics.e2e-spec.ts
git commit -m "feat(analytics): anonymous usage intake endpoint and tables"
```

---

### Task 2: Paris day helpers (extend lot 4's period module)

**Files:**

- Modify: `apps/backend/src/admin/stats/stats-period.ts` (four exports)
- Test: `apps/backend/src/admin/stats/stats-period.spec.ts` (new cases)

**Interfaces:**

- Produces:
  - `parisDateOf(instant: Date): string` — Paris calendar date `YYYY-MM-DD`.
  - `parisMidnightOf(isoDate: string): Date` — 00:00 Paris of that date.
  - `addIsoDays(isoDate: string, days: number): string`
  - `addIsoMonths(isoDate: string, months: number): string` (on the 1st of a month)

- [ ] **Step 1: Add the failing tests** (merge the new names into the file's existing import from `./stats-period`):

```ts
describe('Paris day helpers', () => {
  it('parisDateOf: late UTC evening is the next Paris day', () => {
    expect(parisDateOf(new Date('2026-07-15T21:59:00Z'))).toBe('2026-07-15');
    expect(parisDateOf(new Date('2026-07-15T22:30:00Z'))).toBe('2026-07-16');
    expect(parisDateOf(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });

  it('parisMidnightOf follows DST', () => {
    expect(parisMidnightOf('2026-07-16').toISOString()).toBe('2026-07-15T22:00:00.000Z');
    expect(parisMidnightOf('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('adds days and months on ISO dates', () => {
    expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addIsoMonths('2026-10-01', -25)).toBe('2024-09-01');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter backend exec jest src/admin/stats/stats-period.spec.ts`
Expected: FAIL — `parisDateOf` is not exported.

- [ ] **Step 3: Implement** — append to `stats-period.ts` (it already has private `CalendarDate`, `parisToday`, `parisMidnight`, `addDays`, `addMonths`, `isoDate`):

```ts
const fromIso = (iso: string): CalendarDate => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
};

/** Paris calendar date (YYYY-MM-DD) of an instant. */
export function parisDateOf(instant: Date): string {
  return isoDate(parisToday(instant));
}

/** 00:00 Paris of a calendar date (YYYY-MM-DD). */
export function parisMidnightOf(iso: string): Date {
  return parisMidnight(fromIso(iso));
}

export function addIsoDays(iso: string, days: number): string {
  return isoDate(addDays(fromIso(iso), days));
}

/** Month arithmetic on the 1st of a month. */
export function addIsoMonths(iso: string, months: number): string {
  return isoDate(addMonths(fromIso(iso), months));
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter backend exec jest src/admin/stats/stats-period.spec.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/admin/stats/stats-period.ts apps/backend/src/admin/stats/stats-period.spec.ts
git commit -m "feat(admin): Paris day helpers for usage aggregates"
```

---

### Task 3: Rollup and retention job

**Files:**

- Create: `apps/backend/src/analytics/usage-retention.service.ts`
- Modify: `apps/backend/src/analytics/analytics.module.ts` (provider)
- Test: `apps/backend/src/analytics/usage-retention.service.spec.ts`
- Test (real DB): `apps/backend/test/usage.integration-spec.ts`
- Modify: `apps/backend/test/analytics.e2e-spec.ts` (mock defaults for the boot pass)

**Interfaces:**

- Consumes: `parisDateOf`, `parisMidnightOf`, `addIsoDays`, `addIsoMonths` (Task 2); constants (Task 1).
- Produces:
  - `UsageRetentionService.runPass(trigger: "boot" | "cron"): Promise<void>` (logs, never throws, skips overlapping runs)
  - `UsageRetentionService.rollup(now: Date): Promise<string[]>` (days aggregated)
  - `UsageRetentionService.purge(now: Date): Promise<{ raw: number; daily: number; active: number }>`
  - `UsageRetentionService.aggregatedUntil(): Promise<string | null>`
  - `MAX_ROLLUP_DAYS_PER_RUN = 120`, `PURGE_BATCH = 10_000`

- [ ] **Step 1: Write the failing unit tests**

```ts
// apps/backend/src/analytics/usage-retention.service.spec.ts
import type { PrismaService } from '../prisma/prisma.service';
import { UsageRetentionService } from './usage-retention.service';

const NOW = new Date('2026-10-10T10:00:00Z'); // Paris 2026-10-10, yesterday = 2026-10-09

function makePrisma(state: { lastDay: Date } | null, firstEvent: Date | null) {
  const tx = {
    usageDaily: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    usageDailyActive: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    usageRollupState: { upsert: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  return {
    tx,
    prisma: {
      usageRollupState: {
        findUnique: jest.fn().mockResolvedValue(state),
        upsert: jest.fn().mockResolvedValue({}),
      },
      usageEvent: {
        findFirst: jest.fn().mockResolvedValue(firstEvent ? { occurredAt: firstEvent } : null),
      },
      usageDaily: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      usageDailyActive: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: jest.fn().mockResolvedValue(3),
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
}

const service = (prisma: unknown) => new UsageRetentionService(prisma as PrismaService);

describe('UsageRetentionService.rollup', () => {
  it('aggregates every finished day after the last one, up to yesterday', async () => {
    const { prisma, tx } = makePrisma({ lastDay: new Date('2026-10-07T00:00:00Z') }, null);
    await expect(service(prisma).rollup(NOW)).resolves.toEqual(['2026-10-08', '2026-10-09']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.usageDaily.deleteMany).toHaveBeenCalledWith({
      where: { day: new Date('2026-10-08T00:00:00Z') },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4); // 2 inserts per day
    expect(tx.usageRollupState.upsert).toHaveBeenLastCalledWith({
      where: { id: 1 },
      create: { id: 1, lastDay: new Date('2026-10-09T00:00:00Z') },
      update: { lastDay: new Date('2026-10-09T00:00:00Z') },
    });
  });

  it('first run starts at the Paris day of the oldest event', async () => {
    const { prisma } = makePrisma(null, new Date('2026-10-08T22:30:00Z')); // Paris 2026-10-09
    await expect(service(prisma).rollup(NOW)).resolves.toEqual(['2026-10-09']);
  });

  it('first run without any event records yesterday and aggregates nothing', async () => {
    const { prisma } = makePrisma(null, null);
    await expect(service(prisma).rollup(NOW)).resolves.toEqual([]);
    expect(prisma.usageRollupState.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, lastDay: new Date('2026-10-09T00:00:00Z') },
      update: {},
    });
  });

  it('caps the days per run', async () => {
    const { prisma } = makePrisma({ lastDay: new Date('2025-01-01T00:00:00Z') }, null);
    expect(await service(prisma).rollup(NOW)).toHaveLength(120);
  });

  it('nothing to do when yesterday is already aggregated', async () => {
    const { prisma } = makePrisma({ lastDay: new Date('2026-10-09T00:00:00Z') }, null);
    await expect(service(prisma).rollup(NOW)).resolves.toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('UsageRetentionService.purge', () => {
  // $executeRaw is a tagged template: calls[0] = [strings, cutIso, batch].
  const cutOf = (mock: jest.Mock) => mock.mock.calls[0][1] as string;

  it('never purges raw events of a day not yet aggregated', async () => {
    const { prisma } = makePrisma({ lastDay: new Date('2026-05-01T00:00:00Z') }, null);
    await service(prisma).purge(NOW);
    // start of 2026-05-02 in Paris, earlier than now - 90 days
    expect(cutOf(prisma.$executeRaw)).toBe('2026-05-01T22:00:00.000Z');
  });

  it('raw cut is now - 90 days when up to date; aggregates keep 25 months', async () => {
    const { prisma } = makePrisma({ lastDay: new Date('2026-10-09T00:00:00Z') }, null);
    await expect(service(prisma).purge(NOW)).resolves.toEqual({ raw: 3, daily: 2, active: 1 });
    expect(cutOf(prisma.$executeRaw)).toBe(new Date(NOW.getTime() - 90 * 86_400_000).toISOString());
    expect(prisma.usageDaily.deleteMany).toHaveBeenCalledWith({
      where: { day: { lt: new Date('2024-09-01T00:00:00Z') } },
    });
    expect(prisma.usageDailyActive.deleteMany).toHaveBeenCalledWith({
      where: { day: { lt: new Date('2024-09-01T00:00:00Z') } },
    });
  });

  it('without any rollup state, purges no raw event', async () => {
    const { prisma } = makePrisma(null, null);
    await expect(service(prisma).purge(NOW)).resolves.toMatchObject({ raw: 0 });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('UsageRetentionService.runPass', () => {
  it('never throws', async () => {
    const { prisma } = makePrisma(null, null);
    prisma.usageRollupState.findUnique.mockRejectedValueOnce(new Error('db down'));
    await expect(service(prisma).runPass('cron')).resolves.toBeUndefined();
  });

  it('skips a run that overlaps a running one', async () => {
    const { prisma } = makePrisma(null, null);
    let release!: (v: null) => void;
    prisma.usageRollupState.findUnique.mockReturnValueOnce(
      new Promise((r) => (release = r)) as never,
    );
    const s = service(prisma);
    const first = s.runPass('cron');
    await s.runPass('cron'); // returns at once
    release(null);
    await first;
    // first pass: rollup + purge = 2 reads; the overlapping pass made none
    expect(prisma.usageRollupState.findUnique).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter backend exec jest src/analytics/usage-retention.service.spec.ts`
Expected: FAIL, cannot find module `./usage-retention.service`.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/analytics/usage-retention.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  addIsoDays,
  addIsoMonths,
  parisDateOf,
  parisMidnightOf,
} from '../admin/stats/stats-period';
import { PrismaService } from '../prisma/prisma.service';
import { USAGE_AGG_RETENTION_MONTHS, USAGE_RAW_RETENTION_DAYS } from './usage.constants';

export const MAX_ROLLUP_DAYS_PER_RUN = 120;
export const PURGE_BATCH = 10_000;
const DAY_MS = 86_400_000;

const PARIS = Prisma.sql`AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'`;
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
/** `@db.Date` columns: a Date at 00:00 UTC carries the calendar day. */
const asDbDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOfDbDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Lot 5: rolls finished Paris days of UsageEvent into the anonymous
 * aggregates, then purges. Same pattern as SessionCleanupService: an
 * in-process @Cron never wakes the scale-to-zero app, so a pass also runs
 * at boot.
 */
@Injectable()
export class UsageRetentionService implements OnModuleInit {
  private readonly logger = new Logger(UsageRetentionService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.runPass('boot');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.runPass('cron');
  }

  async runPass(trigger: 'boot' | 'cron'): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const days = await this.rollup(now);
      const purged = await this.purge(now);
      this.logger.log(
        `Usage retention (${trigger}): ${days.length} day(s) aggregated, ` +
          `${purged.raw} raw / ${purged.daily} daily / ${purged.active} active purged`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Usage retention pass failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  async aggregatedUntil(): Promise<string | null> {
    const state = await this.prisma.usageRollupState.findUnique({ where: { id: 1 } });
    return state ? isoOfDbDate(state.lastDay) : null;
  }

  async rollup(now: Date): Promise<string[]> {
    const yesterday = addIsoDays(parisDateOf(now), -1);
    const state = await this.prisma.usageRollupState.findUnique({ where: { id: 1 } });
    let first: string;
    if (state) {
      first = addIsoDays(isoOfDbDate(state.lastDay), 1);
    } else {
      const oldest = await this.prisma.usageEvent.findFirst({
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      });
      if (!oldest) {
        await this.prisma.usageRollupState.upsert({
          where: { id: 1 },
          create: { id: 1, lastDay: asDbDate(yesterday) },
          update: {},
        });
        return [];
      }
      first = parisDateOf(oldest.occurredAt);
    }
    const days: string[] = [];
    for (
      let d = first;
      d <= yesterday && days.length < MAX_ROLLUP_DAYS_PER_RUN;
      d = addIsoDays(d, 1)
    ) {
      days.push(d);
    }
    for (const day of days) await this.rollupDay(day);
    return days;
  }

  /** Idempotent: deletes then rewrites the day, in one transaction. */
  private async rollupDay(day: string): Promise<void> {
    const start = parisMidnightOf(day);
    const end = parisMidnightOf(addIsoDays(day, 1));
    const dbDay = asDbDate(day);
    await this.prisma.$transaction(async (tx) => {
      await tx.usageDaily.deleteMany({ where: { day: dbDay } });
      await tx.usageDailyActive.deleteMany({ where: { day: dbDay } });
      await tx.$executeRaw`
        INSERT INTO "UsageDaily" ("day", "hour", "name", "screen", "platform", "appVersion", "space", "count", "durationSec")
        SELECT ${day}::date,
               extract(hour FROM "occurredAt" ${PARIS})::int,
               "name", coalesce("screen", ''), "platform", "appVersion", "space",
               count(*)::int, coalesce(sum("durationSec"), 0)::int
        FROM "UsageEvent"
        WHERE "occurredAt" >= ${utc(start)} AND "occurredAt" < ${utc(end)}
        GROUP BY 2, 3, 4, 5, 6, 7`;
      await tx.$executeRaw`
        INSERT INTO "UsageDailyActive" ("day", "platform", "installs")
        SELECT ${day}::date, "platform", count(DISTINCT "installId")::int
        FROM "UsageEvent"
        WHERE "occurredAt" >= ${utc(start)} AND "occurredAt" < ${utc(end)}
        GROUP BY "platform"`;
      await tx.usageRollupState.upsert({
        where: { id: 1 },
        create: { id: 1, lastDay: dbDay },
        update: { lastDay: dbDay },
      });
    });
  }

  async purge(now: Date): Promise<{ raw: number; daily: number; active: number }> {
    const state = await this.prisma.usageRollupState.findUnique({ where: { id: 1 } });
    let raw = 0;
    if (state) {
      const retention = new Date(now.getTime() - USAGE_RAW_RETENTION_DAYS * DAY_MS);
      const afterAggregated = parisMidnightOf(addIsoDays(isoOfDbDate(state.lastDay), 1));
      const cut = retention < afterAggregated ? retention : afterAggregated;
      raw = await this.prisma.$executeRaw`
        DELETE FROM "UsageEvent" WHERE "id" IN (
          SELECT "id" FROM "UsageEvent"
          WHERE "occurredAt" < (${cut.toISOString()}::timestamptz AT TIME ZONE 'UTC')
          LIMIT ${PURGE_BATCH})`;
    }
    const firstOfMonth = `${parisDateOf(now).slice(0, 7)}-01`;
    const aggCut = asDbDate(addIsoMonths(firstOfMonth, -USAGE_AGG_RETENTION_MONTHS));
    const [daily, active] = await Promise.all([
      this.prisma.usageDaily.deleteMany({ where: { day: { lt: aggCut } } }),
      this.prisma.usageDailyActive.deleteMany({ where: { day: { lt: aggCut } } }),
    ]);
    return { raw, daily: daily.count, active: active.count };
  }
}
```

Register `UsageRetentionService` in `analytics.module.ts` `providers`. Check that `ScheduleModule.forRoot()` is already imported (the other `@Cron` services rely on it): `grep -rn "ScheduleModule" apps/backend/src`.

- [ ] **Step 4: Run unit tests**

Run: `pnpm --filter backend exec jest src/analytics`
Expected: PASS.

- [ ] **Step 5: Keep the analytics e2e quiet** — the boot pass now runs in e2e against the mock Prisma. It cannot fail the suite (`runPass` catches), but set defaults in `test/analytics.e2e-spec.ts` `beforeAll`, right after `createMockPrismaService()`:

```ts
prisma.usageRollupState.findUnique.mockResolvedValue(null as never);
prisma.usageEvent.findFirst.mockResolvedValue(null as never);
prisma.usageRollupState.upsert.mockResolvedValue({} as never);
prisma.usageDaily.deleteMany.mockResolvedValue({ count: 0 } as never);
prisma.usageDailyActive.deleteMany.mockResolvedValue({ count: 0 } as never);
```

- [ ] **Step 6: Real-DB integration test**

Rows in 2001 (no other data in that window); `now` injected; the boot pass is disabled so it cannot race the tests.

```ts
// apps/backend/test/usage.integration-spec.ts
import { randomUUID } from 'crypto';
import { TestingModule } from '@nestjs/testing';
import { UsageRetentionService } from '../src/analytics/usage-retention.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildServiceModule } from './integration-app.builder';

const NOW = new Date('2001-07-18T10:00:00Z'); // Paris 2001-07-18 (Wednesday), summer time
const BEFORE_2002 = new Date('2002-01-01T00:00:00Z');

describe('Usage analytics (integration, real DB)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: UsageRetentionService;
  const installA = randomUUID();
  const installB = randomUUID();

  beforeAll(async () => {
    jest.spyOn(UsageRetentionService.prototype, 'onModuleInit').mockImplementation(() => undefined);
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    service = moduleRef.get(UsageRetentionService);
  });

  const reset = async () => {
    await prisma.usageEvent.deleteMany({ where: { installId: { in: [installA, installB] } } });
    await prisma.usageDaily.deleteMany({ where: { day: { lt: BEFORE_2002 } } });
    await prisma.usageDailyActive.deleteMany({ where: { day: { lt: BEFORE_2002 } } });
    await prisma.usageRollupState.deleteMany({});
  };
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await moduleRef.close();
  });

  const ev = (installId: string, occurredAt: string, o: Record<string, unknown> = {}) =>
    prisma.usageEvent.create({
      data: {
        installId,
        name: 'screen_view',
        screen: 'Home',
        occurredAt: new Date(occurredAt),
        platform: 'ios',
        appVersion: '1.0.0',
        space: 'LICENSEE',
        durationSec: 10,
        ...o,
      },
    });
  const state = (lastDay: string) =>
    prisma.usageRollupState.create({ data: { id: 1, lastDay: new Date(`${lastDay}T00:00:00Z`) } });

  it('23:30 UTC lands in the next Paris day; re-running a day does not double', async () => {
    await state('2001-07-15');
    await ev(installA, '2001-07-16T23:30:00Z'); // Paris 2001-07-17 01:30
    await ev(installA, '2001-07-16T21:30:00Z'); // Paris 2001-07-16 23:30
    await ev(installB, '2001-07-16T21:45:00Z', { platform: 'android' });
    expect(await service.rollup(NOW)).toEqual(['2001-07-16', '2001-07-17']);
    await prisma.usageRollupState.update({
      where: { id: 1 },
      data: { lastDay: new Date('2001-07-15T00:00:00Z') },
    });
    await service.rollup(NOW); // same days again

    const daily = await prisma.usageDaily.findMany({
      where: { day: { lt: BEFORE_2002 } },
      orderBy: [{ day: 'asc' }, { hour: 'asc' }, { platform: 'asc' }],
      take: 10,
    });
    expect(
      daily.map((d) => [
        d.day.toISOString().slice(0, 10),
        d.hour,
        d.platform,
        d.count,
        d.durationSec,
      ]),
    ).toEqual([
      ['2001-07-16', 23, 'android', 1, 10],
      ['2001-07-16', 23, 'ios', 1, 10],
      ['2001-07-17', 1, 'ios', 1, 10],
    ]);
    const active = await prisma.usageDailyActive.findMany({
      where: { day: { lt: BEFORE_2002 } },
      orderBy: [{ day: 'asc' }, { platform: 'asc' }],
      take: 10,
    });
    expect(active.map((a) => [a.day.toISOString().slice(0, 10), a.platform, a.installs])).toEqual([
      ['2001-07-16', 'android', 1],
      ['2001-07-16', 'ios', 1],
      ['2001-07-17', 'ios', 1],
    ]);
  });

  it('distinct installs: two events of one install count once', async () => {
    await state('2001-07-16');
    await ev(installA, '2001-07-17T08:00:00Z');
    await ev(installA, '2001-07-17T09:00:00Z');
    await service.rollup(NOW);
    const active = await prisma.usageDailyActive.findUnique({
      where: { day_platform: { day: new Date('2001-07-17T00:00:00Z'), platform: 'ios' } },
    });
    expect(active?.installs).toBe(1);
  });
});
```

Run on the test DB (test-DB env, then `npx prisma db push`): `npx jest --config ./test/jest-integration.json --runInBand --forceExit test/usage.integration-spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/analytics apps/backend/test/usage.integration-spec.ts apps/backend/test/analytics.e2e-spec.ts
git commit -m "feat(analytics): daily usage rollup and retention purge"
```

---

### Task 4: Read API `GET /admin/usage`

**Files:**

- Create: `apps/backend/src/analytics/dto/admin-usage.dto.ts`
- Create: `apps/backend/src/analytics/admin-usage.query-service.ts`
- Create: `apps/backend/src/analytics/admin-usage.controller.ts`
- Modify: `apps/backend/src/analytics/analytics.module.ts` (controller, provider, guard imports — copy what `AdminModule` imports for `JwtAuthGuard` / `RolesGuard`, at least `AuthModule`)
- Test: `apps/backend/src/analytics/admin-usage.query-service.spec.ts`, `apps/backend/src/analytics/admin-usage.controller.spec.ts`
- Modify: `apps/backend/test/usage.integration-spec.ts`, `apps/backend/test/admin.e2e-spec.ts`
- Modify: `apps/backend/swagger.json`, `apps/docs/public/swagger.json` (regenerated)

**Interfaces:**

- Consumes: Task 1 constants; Task 2 helpers; `UsageRetentionService.aggregatedUntil()` (Task 3); lot 4 `zeroFill`, `statsWindow`, `SeriesRow`.
- Produces:
  - `USAGE_PERIODS = ["7d", "30d", "12m"] as const`, `type UsagePeriod`
  - `AdminUsageQueryDto { period?: UsagePeriod; space?: UsageSpace }`, `AdminUsageDto`
  - `AdminUsageQueryService.get(period: UsagePeriod, space?: UsageSpace, now?: Date): Promise<AdminUsageDto>`
  - Route `GET /api/v1/admin/usage` (SDK `adminUsageControllerGet` after `api:sync`).

- [ ] **Step 1: DTOs**

```ts
// apps/backend/src/analytics/dto/admin-usage.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { USAGE_SPACES, type UsageSpace } from '../usage.constants';

export const USAGE_PERIODS = ['7d', '30d', '12m'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export class AdminUsageQueryDto {
  @ApiPropertyOptional({ enum: USAGE_PERIODS, default: '30d' })
  @IsOptional()
  @IsIn(USAGE_PERIODS)
  period?: UsagePeriod;

  @ApiPropertyOptional({ enum: USAGE_SPACES, description: 'Filters the screen ranking only' })
  @IsOptional()
  @IsIn(USAGE_SPACES)
  space?: UsageSpace;
}

export class UsagePlatformsDto {
  @ApiProperty() ios!: number;
  @ApiProperty() android!: number;
}

export class UsageScreenDto {
  @ApiProperty() screen!: string;
  @ApiProperty() views!: number;
  @ApiProperty() durationSec!: number;
}

export class UsageEventBucketDto {
  @ApiProperty() start!: string;
  @ApiProperty() login!: number;
  @ApiProperty() login_biometric!: number;
  @ApiProperty() login_guest!: number;
  @ApiProperty() register!: number;
  @ApiProperty() license_scan!: number;
  @ApiProperty() license_wallet_add!: number;
}

export class UsageVersionDto {
  @ApiProperty() appVersion!: string;
  @ApiProperty() installs!: number;
}

export class UsageCompetitionDto {
  @ApiProperty() competitionId!: string;
  @ApiProperty({ type: String, nullable: true }) title!: string | null;
  @ApiProperty() views!: number;
}

export class AdminUsageDto {
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ enum: USAGE_PERIODS }) period!: UsagePeriod;
  @ApiProperty({ description: 'YYYY-MM-DD (Paris), inclusive' }) from!: string;
  @ApiProperty({ description: 'YYYY-MM-DD (Paris), inclusive' }) to!: string;
  @ApiProperty({ enum: ['day', 'month'] }) bucket!: 'day' | 'month';
  @ApiProperty({ type: String, nullable: true }) aggregatedUntil!: string | null;
  @ApiProperty() activeInstallsPerDay!: number;
  @ApiProperty() activeInstallsThisMonth!: number;
  @ApiProperty({ type: Number, nullable: true }) sessions!: number | null;
  @ApiProperty({ type: Number, nullable: true }) medianSessionMinutes!: number | null;
  @ApiProperty({ type: UsagePlatformsDto }) platforms!: UsagePlatformsDto;
  @ApiProperty({
    description: '7 rows (Monday first) × 24 hours, Paris time',
    type: 'array',
    items: { type: 'array', items: { type: 'number' } },
  })
  heatmap!: number[][];
  @ApiProperty({ type: [UsageScreenDto] }) screens!: UsageScreenDto[];
  @ApiProperty({ type: [UsageEventBucketDto] }) events!: UsageEventBucketDto[];
  @ApiProperty({ type: [UsageVersionDto] }) versions!: UsageVersionDto[];
  @ApiProperty({ type: [UsageCompetitionDto] }) competitions!: UsageCompetitionDto[];
}
```

- [ ] **Step 2: Write the failing unit tests**

Every raw query carries a marker comment `/* usage:<name> */`; the double answers by marker.

```ts
// apps/backend/src/analytics/admin-usage.query-service.spec.ts
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminUsageQueryService } from './admin-usage.query-service';
import type { UsageRetentionService } from './usage-retention.service';

const NOW = new Date('2026-10-10T10:00:00Z');
const markerOf = (sql: Prisma.Sql) => /\/\* usage:(\w+) \*\//.exec(sql.sql)?.[1] ?? '';

function makePrisma(answers: Record<string, unknown[]> = {}) {
  return {
    $queryRaw: jest.fn((sql: Prisma.Sql) => Promise.resolve(answers[markerOf(sql)] ?? [])),
    competition: { findMany: jest.fn().mockResolvedValue([]) },
  };
}
const retention = (until: string | null) =>
  ({ aggregatedUntil: jest.fn().mockResolvedValue(until) }) as unknown as UsageRetentionService;
const serviceOf = (prisma: unknown, until: string | null = null) =>
  new AdminUsageQueryService(prisma as PrismaService, retention(until));

describe('AdminUsageQueryService', () => {
  it('empty period: zero-filled days, null median, empty tables, 7×24 zero grid', async () => {
    const prisma = makePrisma({ sessions: [{ sessions: 0, median: null }] });
    const u = await serviceOf(prisma).get('30d', undefined, NOW);
    expect(u.bucket).toBe('day');
    expect(u.from).toBe('2026-09-11');
    expect(u.to).toBe('2026-10-10');
    expect(u.events).toHaveLength(30);
    expect(u.events[0]).toEqual({
      start: '2026-09-11',
      login: 0,
      login_biometric: 0,
      login_guest: 0,
      register: 0,
      license_scan: 0,
      license_wallet_add: 0,
    });
    expect(u.heatmap).toHaveLength(7);
    expect(u.heatmap.every((row) => row.length === 24 && row.every((c) => c === 0))).toBe(true);
    expect(u.sessions).toBe(0);
    expect(u.medianSessionMinutes).toBeNull();
    expect(u.activeInstallsPerDay).toBe(0);
    expect(u.activeInstallsThisMonth).toBe(0);
    expect(u.screens).toEqual([]);
    expect(u.competitions).toEqual([]);
    expect(prisma.competition.findMany).not.toHaveBeenCalled();
    expect(u.aggregatedUntil).toBeNull();
  });

  it('maps raw results (bigint counts) onto the response', async () => {
    const prisma = makePrisma({
      heatmap: [
        { dow: 0, hour: 9, count: BigInt(5) },
        { dow: 6, hour: 23, count: BigInt(2) },
      ],
      actives: [
        { day: '2026-10-09', installs: BigInt(6) },
        { day: '2026-10-10', installs: BigInt(3) },
      ],
      month: [{ installs: BigInt(12) }],
      sessions: [{ sessions: BigInt(4), median: 450 }],
      platforms: [
        { platform: 'ios', count: BigInt(7) },
        { platform: 'android', count: BigInt(3) },
      ],
      screens: [{ screen: 'Home', views: BigInt(9), durationSec: BigInt(120) }],
      events: [{ start: '2026-10-10', key: 'login', count: BigInt(2) }],
      versions: [{ appVersion: '1.4.2', installs: BigInt(5) }],
      competitions: [
        { competitionId: 'c1', views: BigInt(3) },
        { competitionId: 'c2', views: BigInt(1) },
      ],
    });
    prisma.competition.findMany.mockResolvedValue([{ id: 'c1', title: 'Open de Lyon' }]);
    const u = await serviceOf(prisma).get('7d', undefined, NOW);
    expect(u.heatmap[0][9]).toBe(5);
    expect(u.heatmap[6][23]).toBe(2);
    expect(u.activeInstallsPerDay).toBe(1.3); // (6 + 3) / 7 days
    expect(u.activeInstallsThisMonth).toBe(12);
    expect(u.sessions).toBe(4);
    expect(u.medianSessionMinutes).toBe(7.5);
    expect(u.platforms).toEqual({ ios: 7, android: 3 });
    expect(u.screens).toEqual([{ screen: 'Home', views: 9, durationSec: 120 }]);
    expect(u.events[6].login).toBe(2);
    expect(u.versions).toEqual([{ appVersion: '1.4.2', installs: 5 }]);
    expect(u.competitions).toEqual([
      { competitionId: 'c1', title: 'Open de Lyon', views: 3 },
      { competitionId: 'c2', title: null, views: 1 },
    ]);
    expect(prisma.competition.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2'] } },
      select: { id: true, title: true },
      take: 2,
    });
  });

  it('12m: monthly buckets from aggregates bounded to today, no sessions', async () => {
    const prisma = makePrisma();
    const u = await serviceOf(prisma, '2026-10-09').get('12m', undefined, NOW);
    expect(u.bucket).toBe('month');
    expect(u.events).toHaveLength(12);
    expect(u.events[11].start).toBe('2026-10-01');
    expect(u.sessions).toBeNull();
    expect(u.medianSessionMinutes).toBeNull();
    expect(u.aggregatedUntil).toBe('2026-10-09');
    const sqls = prisma.$queryRaw.mock.calls.map((c) => c[0] as Prisma.Sql);
    const markers = sqls.map(markerOf);
    expect(markers).toEqual(
      expect.arrayContaining([
        'heatmapAgg',
        'activesAgg',
        'screensAgg',
        'eventsAgg',
        'platformsAgg',
      ]),
    );
    expect(markers).not.toContain('sessions');
    const heatmapAgg = sqls.find((s) => markerOf(s) === 'heatmapAgg');
    expect(heatmapAgg?.values).toEqual(['2025-11-01', '2026-10-10']);
  });

  it('space filter applies to screens only', async () => {
    const prisma = makePrisma();
    await serviceOf(prisma).get('30d', 'CLUB', NOW);
    const sqls = prisma.$queryRaw.mock.calls.map((c) => c[0] as Prisma.Sql);
    expect(sqls.find((s) => markerOf(s) === 'screens')?.values).toContain('CLUB');
    expect(sqls.find((s) => markerOf(s) === 'heatmap')?.values).not.toContain('CLUB');
  });
});
```

```ts
// apps/backend/src/analytics/admin-usage.controller.spec.ts
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AdminUsageController } from './admin-usage.controller';
import type { AdminUsageQueryService } from './admin-usage.query-service';

describe('AdminUsageController', () => {
  it('is ADMIN-only at class level', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminUsageController)).toEqual([UserRole.ADMIN]);
  });

  it('defaults to 30d and passes the space through', async () => {
    const get = jest.fn().mockResolvedValue({});
    const controller = new AdminUsageController({ get } as unknown as AdminUsageQueryService);
    await controller.get({});
    expect(get).toHaveBeenCalledWith('30d', undefined);
    await controller.get({ period: '7d', space: 'CLUB' });
    expect(get).toHaveBeenLastCalledWith('7d', 'CLUB');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter backend exec jest src/analytics/admin-usage`
Expected: FAIL, cannot find modules.

- [ ] **Step 4: Implement the query service**

```ts
// apps/backend/src/analytics/admin-usage.query-service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addIsoDays,
  parisDateOf,
  parisMidnightOf,
  statsWindow,
  zeroFill,
  type SeriesRow,
} from '../admin/stats/stats-period';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminUsageDto, UsagePeriod } from './dto/admin-usage.dto';
import { USAGE_KEY_EVENTS, USAGE_SESSION_GAP_MINUTES, type UsageSpace } from './usage.constants';
import { UsageRetentionService } from './usage-retention.service';

const PARIS = Prisma.sql`AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'`;
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const round1 = (v: number) => Math.round(v * 10) / 10;
const KEY_EVENTS = Prisma.join([...USAGE_KEY_EVENTS]);
const SESSION_GAP = Prisma.raw(`interval '${USAGE_SESSION_GAP_MINUTES} minutes'`);
const DAYS: Record<'7d' | '30d', number> = { '7d': 7, '30d': 30 };

interface RawWindow {
  start: Date;
  end: Date;
}
/** Inclusive Paris dates on @db.Date aggregate columns. */
interface DayRange {
  from: string;
  to: string;
}
type Count = bigint | number;

/** Back-office usage dashboard (lot 5): aggregates only, never one install. */
@Injectable()
export class AdminUsageQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: UsageRetentionService,
  ) {}

  async get(
    period: UsagePeriod,
    space?: UsageSpace,
    now: Date = new Date(),
  ): Promise<AdminUsageDto> {
    const today = parisDateOf(now);
    const tomorrow = parisMidnightOf(addIsoDays(today, 1));
    const [activeInstallsThisMonth, versions] = await Promise.all([
      this.distinctInstalls({ start: parisMidnightOf(`${today.slice(0, 7)}-01`), end: tomorrow }),
      this.versions({ start: parisMidnightOf(addIsoDays(today, -6)), end: tomorrow }),
    ]);
    const base = {
      generatedAt: now.toISOString(),
      period,
      to: today,
      activeInstallsThisMonth,
      versions,
    };

    if (period === '12m') {
      const months = statsWindow('12m', now).buckets;
      const range: DayRange = { from: months[0], to: today };
      const [
        aggregatedUntil,
        heatmap,
        activeInstallsPerDay,
        platforms,
        screens,
        events,
        competitions,
      ] = await Promise.all([
        this.retention.aggregatedUntil(),
        this.heatmapAgg(range),
        this.activesAgg(range),
        this.platformsAgg(range),
        this.screensAgg(range, space),
        this.eventsAgg(range, months),
        // Aggregates do not keep the competition: last 90 days of raw events.
        this.competitions({ start: parisMidnightOf(addIsoDays(today, -89)), end: tomorrow }),
      ]);
      return {
        ...base,
        from: range.from,
        bucket: 'month',
        aggregatedUntil,
        activeInstallsPerDay,
        sessions: null,
        medianSessionMinutes: null,
        platforms,
        heatmap,
        screens,
        events,
        competitions,
      };
    }

    const days = DAYS[period];
    const from = addIsoDays(today, -(days - 1));
    const w: RawWindow = { start: parisMidnightOf(from), end: tomorrow };
    const dayKeys = Array.from({ length: days }, (_, i) => addIsoDays(from, i));
    const [heatmap, activeInstallsPerDay, sessions, platforms, screens, events, competitions] =
      await Promise.all([
        this.heatmap(w),
        this.activesPerDay(w, days),
        this.sessions(w),
        this.platforms(w),
        this.screens(w, space),
        this.events(w, dayKeys),
        this.competitions(w),
      ]);
    return {
      ...base,
      from,
      bucket: 'day',
      aggregatedUntil: null,
      activeInstallsPerDay,
      ...sessions,
      platforms,
      heatmap,
      screens,
      events,
      competitions,
    };
  }

  // --- raw events (7d / 30d) -------------------------------------------------

  private inWindow(w: RawWindow) {
    return Prisma.sql`"occurredAt" >= ${utc(w.start)} AND "occurredAt" < ${utc(w.end)}`;
  }

  private async heatmap(w: RawWindow): Promise<number[][]> {
    const rows = await this.prisma.$queryRaw<
      { dow: number; hour: number; count: Count }[]
    >(Prisma.sql`
      /* usage:heatmap */
      SELECT (extract(isodow FROM "occurredAt" ${PARIS})::int - 1) AS dow,
             extract(hour FROM "occurredAt" ${PARIS})::int AS hour,
             count(*) AS count
      FROM "UsageEvent" WHERE ${this.inWindow(w)} GROUP BY 1, 2`);
    return toGrid(rows);
  }

  /** Average of daily distinct installs over the period (days without events count as 0). */
  private async activesPerDay(w: RawWindow, days: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ day: string; installs: Count }[]>(Prisma.sql`
      /* usage:actives */
      SELECT to_char(("occurredAt" ${PARIS})::date, 'YYYY-MM-DD') AS day,
             count(DISTINCT "installId") AS installs
      FROM "UsageEvent" WHERE ${this.inWindow(w)} GROUP BY 1`);
    return round1(rows.reduce((s, r) => s + n(r.installs), 0) / days);
  }

  private async distinctInstalls(w: RawWindow): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ installs: Count }[]>(Prisma.sql`
      /* usage:month */
      SELECT count(DISTINCT "installId") AS installs FROM "UsageEvent" WHERE ${this.inWindow(w)}`);
    return n(row?.installs);
  }

  private async sessions(
    w: RawWindow,
  ): Promise<{ sessions: number; medianSessionMinutes: number | null }> {
    const [row] = await this.prisma.$queryRaw<
      { sessions: Count; median: number | null }[]
    >(Prisma.sql`
      /* usage:sessions */
      WITH e AS (
        SELECT "installId", "occurredAt",
               "occurredAt" - lag("occurredAt") OVER (PARTITION BY "installId" ORDER BY "occurredAt") AS gap
        FROM "UsageEvent" WHERE ${this.inWindow(w)}
      ), s AS (
        SELECT "installId", "occurredAt",
               sum(CASE WHEN gap IS NULL OR gap >= ${SESSION_GAP} THEN 1 ELSE 0 END)
                 OVER (PARTITION BY "installId" ORDER BY "occurredAt") AS sid
        FROM e
      ), d AS (
        SELECT extract(epoch FROM max("occurredAt") - min("occurredAt")) AS secs
        FROM s GROUP BY "installId", sid
      )
      SELECT count(*) AS sessions,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)::float8 AS median
      FROM d`);
    const sessions = n(row?.sessions);
    const median = row?.median ?? null;
    return {
      sessions,
      medianSessionMinutes: sessions === 0 || median === null ? null : round1(median / 60),
    };
  }

  private async platforms(w: RawWindow) {
    const rows = await this.prisma.$queryRaw<{ platform: string; count: Count }[]>(Prisma.sql`
      /* usage:platforms */
      SELECT "platform", count(*) AS count FROM "UsageEvent" WHERE ${this.inWindow(w)} GROUP BY 1`);
    return toPlatforms(rows);
  }

  private async screens(w: RawWindow, space?: UsageSpace) {
    const bySpace = space ? Prisma.sql`AND "space" = ${space}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      { screen: string; views: Count; durationSec: Count }[]
    >(Prisma.sql`
      /* usage:screens */
      SELECT "screen", count(*) AS views, coalesce(sum("durationSec"), 0) AS "durationSec"
      FROM "UsageEvent"
      WHERE ${this.inWindow(w)} AND "name" = 'screen_view' AND "screen" IS NOT NULL ${bySpace}
      GROUP BY 1 ORDER BY views DESC, 1 ASC LIMIT 30`);
    return toScreens(rows);
  }

  private async events(w: RawWindow, dayKeys: string[]) {
    const rows = await this.prisma.$queryRaw<
      { start: string; key: string; count: Count }[]
    >(Prisma.sql`
      /* usage:events */
      SELECT to_char(("occurredAt" ${PARIS})::date, 'YYYY-MM-DD') AS start, "name" AS key, count(*) AS count
      FROM "UsageEvent" WHERE ${this.inWindow(w)} AND "name" IN (${KEY_EVENTS}) GROUP BY 1, 2`);
    return zeroFill(dayKeys, toSeries(rows), USAGE_KEY_EVENTS);
  }

  private async versions(w: RawWindow) {
    const rows = await this.prisma.$queryRaw<{ appVersion: string; installs: Count }[]>(Prisma.sql`
      /* usage:versions */
      SELECT "appVersion", count(DISTINCT "installId") AS installs
      FROM "UsageEvent" WHERE ${this.inWindow(w)}
      GROUP BY 1 ORDER BY installs DESC, 1 DESC LIMIT 10`);
    return rows.map((r) => ({ appVersion: r.appVersion, installs: n(r.installs) }));
  }

  private async competitions(w: RawWindow) {
    const rows = await this.prisma.$queryRaw<{ competitionId: string; views: Count }[]>(Prisma.sql`
      /* usage:competitions */
      SELECT "competitionId", count(*) AS views FROM "UsageEvent"
      WHERE ${this.inWindow(w)} AND "name" = 'competition_view' AND "competitionId" IS NOT NULL
      GROUP BY 1 ORDER BY views DESC, 1 ASC LIMIT 10`);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.competitionId);
    const found = await this.prisma.competition.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
      take: ids.length,
    });
    const titleOf = new Map(found.map((c) => [c.id, c.title]));
    return rows.map((r) => ({
      competitionId: r.competitionId,
      title: titleOf.get(r.competitionId) ?? null,
      views: n(r.views),
    }));
  }

  // --- aggregates (12 months) -------------------------------------------------

  private inDays(r: DayRange) {
    return Prisma.sql`"day" >= ${r.from}::date AND "day" <= ${r.to}::date`;
  }

  private async heatmapAgg(r: DayRange): Promise<number[][]> {
    const rows = await this.prisma.$queryRaw<
      { dow: number; hour: number; count: Count }[]
    >(Prisma.sql`
      /* usage:heatmapAgg */
      SELECT (extract(isodow FROM "day")::int - 1) AS dow, "hour", sum("count") AS count
      FROM "UsageDaily" WHERE ${this.inDays(r)} GROUP BY 1, 2`);
    return toGrid(rows);
  }

  private async activesAgg(r: DayRange): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ avg: number | null }[]>(Prisma.sql`
      /* usage:activesAgg */
      SELECT avg(t)::float8 AS avg FROM (
        SELECT sum("installs") AS t FROM "UsageDailyActive" WHERE ${this.inDays(r)} GROUP BY "day"
      ) d`);
    return round1(Number(row?.avg ?? 0));
  }

  private async platformsAgg(r: DayRange) {
    const rows = await this.prisma.$queryRaw<{ platform: string; count: Count }[]>(Prisma.sql`
      /* usage:platformsAgg */
      SELECT "platform", sum("count") AS count FROM "UsageDaily" WHERE ${this.inDays(r)} GROUP BY 1`);
    return toPlatforms(rows);
  }

  private async screensAgg(r: DayRange, space?: UsageSpace) {
    const bySpace = space ? Prisma.sql`AND "space" = ${space}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      { screen: string; views: Count; durationSec: Count }[]
    >(Prisma.sql`
      /* usage:screensAgg */
      SELECT "screen", sum("count") AS views, sum("durationSec") AS "durationSec" FROM "UsageDaily"
      WHERE ${this.inDays(r)} AND "name" = 'screen_view' AND "screen" <> '' ${bySpace}
      GROUP BY 1 ORDER BY views DESC, 1 ASC LIMIT 30`);
    return toScreens(rows);
  }

  private async eventsAgg(r: DayRange, months: string[]) {
    const rows = await this.prisma.$queryRaw<
      { start: string; key: string; count: Count }[]
    >(Prisma.sql`
      /* usage:eventsAgg */
      SELECT to_char(date_trunc('month', "day"), 'YYYY-MM-DD') AS start, "name" AS key, sum("count") AS count
      FROM "UsageDaily" WHERE ${this.inDays(r)} AND "name" IN (${KEY_EVENTS}) GROUP BY 1, 2`);
    return zeroFill(months, toSeries(rows), USAGE_KEY_EVENTS);
  }
}

function toGrid(rows: { dow: number; hour: number; count: Count }[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rows) {
    const dow = Number(r.dow);
    const hour = Number(r.hour);
    if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) grid[dow][hour] += n(r.count);
  }
  return grid;
}

function toPlatforms(rows: { platform: string; count: Count }[]) {
  const out = { ios: 0, android: 0 };
  for (const r of rows) {
    if (r.platform === 'ios' || r.platform === 'android') out[r.platform] = n(r.count);
  }
  return out;
}

function toScreens(rows: { screen: string; views: Count; durationSec: Count }[]) {
  return rows.map((r) => ({ screen: r.screen, views: n(r.views), durationSec: n(r.durationSec) }));
}

function toSeries(rows: { start: string; key: string; count: Count }[]): SeriesRow[] {
  return rows.map((r) => ({ start: r.start, key: r.key, count: n(r.count) }));
}
```

- [ ] **Step 5: Implement the controller and register**

```ts
// apps/backend/src/analytics/admin-usage.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiCommonErrorResponses } from '../common/decorators/api-error-responses.decorator';
import { AdminUsageQueryService } from './admin-usage.query-service';
import { AdminUsageDto, AdminUsageQueryDto } from './dto/admin-usage.dto';

/** Back-office usage dashboard (lot 5). Guards on the CLASS. */
@ApiTags('admin')
@ApiCommonErrorResponses()
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/usage')
export class AdminUsageController {
  constructor(private readonly usage: AdminUsageQueryService) {}

  @Get()
  @ApiOperation({ summary: 'Anonymous app usage for the back-office (aggregates)' })
  @ApiResponse({ status: 200, type: AdminUsageDto })
  get(@Query() q: AdminUsageQueryDto): Promise<AdminUsageDto> {
    return this.usage.get(q.period ?? '30d', q.space);
  }
}
```

In `analytics.module.ts`: add `AdminUsageController` to `controllers`, `AdminUsageQueryService` to `providers`, and the guard imports (`AuthModule`, as `AdminModule` has it).

- [ ] **Step 6: Run unit tests**

Run: `pnpm --filter backend exec jest src/analytics`
Expected: PASS.

- [ ] **Step 7: Real-DB read tests** — append to `test/usage.integration-spec.ts` (import `AdminUsageQueryService` from `../src/analytics/admin-usage.query-service`):

```ts
it('7d read: Paris heatmap, sessions split at 30 minutes, median', async () => {
  const usage = moduleRef.get(AdminUsageQueryService);
  await ev(installA, '2001-07-16T06:00:00Z'); // Mon 08:00 Paris
  await ev(installA, '2001-07-16T06:10:00Z'); // same session (10 min)
  await ev(installA, '2001-07-16T07:00:00Z'); // 50-min gap → new session (Mon 09:00)
  await ev(installB, '2001-07-15T22:30:00Z'); // Sunday UTC = Mon 00:30 Paris
  const u = await usage.get('7d', undefined, NOW);
  expect(u.heatmap[0][8]).toBe(2);
  expect(u.heatmap[0][9]).toBe(1);
  expect(u.heatmap[0][0]).toBe(1);
  expect(u.sessions).toBe(3); // A: 2, B: 1
  expect(u.medianSessionMinutes).toBe(0); // durations 10, 0, 0 min
  expect(u.screens).toEqual([{ screen: 'Home', views: 4, durationSec: 40 }]);
  expect(u.activeInstallsThisMonth).toBe(2);
});

it('12m read comes from the aggregates', async () => {
  const usage = moduleRef.get(AdminUsageQueryService);
  await state('2001-07-15');
  await ev(installA, '2001-07-16T06:00:00Z');
  await ev(installB, '2001-07-16T06:30:00Z', { platform: 'android' });
  await service.rollup(NOW);
  const u = await usage.get('12m', undefined, NOW);
  expect(u.aggregatedUntil).toBe('2001-07-17');
  expect(u.heatmap[0][8]).toBe(2);
  expect(u.platforms).toEqual({ ios: 1, android: 1 });
  expect(u.screens[0]).toEqual({ screen: 'Home', views: 2, durationSec: 20 });
});
```

Run as in Task 3 Step 6. Expected: PASS (4 tests).

- [ ] **Step 8: E2E matrix + 400** — in `test/admin.e2e-spec.ts`, add to `ADMIN_ROUTES`:

```ts
  // App usage (lot 5): ADMIN-only at class level.
  ["get", "/api/v1/admin/usage"],
  ["get", "/api/v1/admin/usage?period=7d&space=CLUB"],
```

and at the end of the describe:

```ts
it('rejects an unknown usage period with 400', async () => {
  currentRole = UserRole.ADMIN;
  await request(server()).get('/api/v1/admin/usage?period=1y').expect(400);
});
```

Add the five mock defaults of Task 3 Step 5 right after `createMockPrismaService()` in this file too. Run with the test-DB env: `pnpm test:e2e -- test/admin.e2e-spec.ts test/analytics.e2e-spec.ts`. Expected: PASS.

- [ ] **Step 9: Regenerate Swagger** (command in Global Constraints). Expected: `swagger.json` contains `/admin/usage`, `/analytics/events`, `AdminUsageDto`, and the operation ids `AdminUsageController_get`, `AnalyticsController_ingest`.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/analytics apps/backend/test/usage.integration-spec.ts apps/backend/test/admin.e2e-spec.ts apps/backend/test/analytics.e2e-spec.ts apps/backend/swagger.json apps/docs/public/swagger.json
git commit -m "feat(analytics): GET /admin/usage dashboard aggregates"
```

---

### Task 5: Client usage recorder (buffer, install ID, flush policy)

**Files:**

- Create: `apps/client/src/services/analytics/usageRecorder.ts`
- Test: `apps/client/src/services/analytics/__tests__/usageRecorder.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type UsageSpace = 'LICENSEE' | 'CLUB' | 'STAFF' | 'ADMIN' | 'GUEST';
  export interface UsageContext {
    space: UsageSpace;
    storeReview: boolean;
  }
  export interface UsageInput {
    name: AnalyticsEventName;
    screen?: string;
    competitionId?: string;
    durationSec?: number;
    occurredAt?: Date;
  }
  export interface UsageRecord {
    installId: string;
    name: AnalyticsEventName;
    screen?: string;
    occurredAt: string;
    platform: 'ios' | 'android';
    appVersion: string;
    space: UsageSpace;
    competitionId?: string;
    durationSec?: number;
  }
  export interface UsageStorage {
    getItem(k: string): Promise<string | null>;
    setItem(k: string, v: string): Promise<void>;
    removeItem(k: string): Promise<void>;
  }
  export interface UsageDeps {
    storage: UsageStorage;
    now(): Date;
    random(): number;
    platform: 'ios' | 'android' | null;
    appVersion: string;
    context(): UsageContext;
    send(events: UsageRecord[]): Promise<number>;
  }
  export interface UsageRecorder {
    record(input: UsageInput): Promise<void>;
    /** Marks the backend awake; resolves when the flush it may trigger is done. */
    onApiSuccess(): Promise<void>;
    onBackground(): Promise<void>;
    setEnabled(on: boolean): Promise<void>;
    isEnabled(): Promise<boolean>;
    clear(): Promise<void>;
  }
  export function createUsageRecorder(deps: UsageDeps): UsageRecorder;
  export function uuidV4(random: () => number): string;
  export const USAGE_KEYS = {
    buffer: 'usage_buffer',
    install: 'usage_install',
    optOut: 'usage_opt_out',
  } as const;
  export const USAGE_LIMITS = {
    buffer: 500,
    batch: 200,
    flushEveryMs: 120_000,
    backgroundWindowMs: 300_000,
    maxDurationSec: 1800,
  } as const;
  ```

  `send` resolves the HTTP status, 0 on network error.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/client/src/services/analytics/__tests__/usageRecorder.test.ts
import {
  createUsageRecorder,
  USAGE_KEYS,
  uuidV4,
  type UsageDeps,
  type UsageRecord,
} from '../usageRecorder';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: jest.fn(async (k: string) => map.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      map.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      map.delete(k);
    }),
  };
}

function setup(o: Partial<UsageDeps> = {}) {
  const storage = memoryStorage();
  let clock = new Date('2026-10-10T08:15:42.000Z');
  const sent: UsageRecord[][] = [];
  const send = jest.fn(async (events: UsageRecord[]) => {
    sent.push(events);
    return 204;
  });
  const deps: UsageDeps = {
    storage,
    now: () => clock,
    random: Math.random,
    platform: 'ios',
    appVersion: '1.4.2',
    context: () => ({ space: 'LICENSEE', storeReview: false }),
    send,
    ...o,
  };
  const recorder = createUsageRecorder(deps);
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const buffer = () => JSON.parse(storage.map.get(USAGE_KEYS.buffer) ?? '[]') as UsageRecord[];
  return { recorder, storage, send: deps.send as jest.Mock, sent, advance, buffer };
}

describe('uuidV4', () => {
  it('produces RFC 4122 v4 UUIDs', () => {
    expect(uuidV4(Math.random)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('usageRecorder', () => {
  it('records whitelisted fields only, minute precision, context space', async () => {
    const { recorder, buffer } = setup();
    await recorder.record({
      name: 'competition_view',
      competitionId: '00000000-0000-4000-8000-000000000000',
      screen: 'CompetitionDetail',
    });
    expect(buffer()[0]).toEqual({
      installId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'competition_view',
      screen: 'CompetitionDetail',
      occurredAt: '2026-10-10T08:15:00.000Z',
      platform: 'ios',
      appVersion: '1.4.2',
      space: 'LICENSEE',
      competitionId: '00000000-0000-4000-8000-000000000000',
    });
  });

  it('drops a competitionId that is not a UUID and caps the duration', async () => {
    const { recorder, buffer } = setup();
    await recorder.record({
      name: 'screen_view',
      screen: 'Home',
      competitionId: '42',
      durationSec: 5000,
    });
    expect(buffer()[0].competitionId).toBeUndefined();
    expect(buffer()[0].durationSec).toBe(1800);
  });

  it('keeps the newest 500 events', async () => {
    const { recorder, buffer, advance } = setup();
    for (let i = 0; i < 502; i++) {
      advance(60_000);
      await recorder.record({ name: 'login' });
    }
    const b = buffer();
    expect(b).toHaveLength(500);
    expect(b[0].occurredAt).toBe('2026-10-10T08:18:00.000Z'); // first two (08:16, 08:17) dropped
  });

  it('keeps the install ID within a month and renews it the next month', async () => {
    const { recorder, buffer, advance } = setup();
    await recorder.record({ name: 'login' });
    advance(86_400_000);
    await recorder.record({ name: 'login' });
    advance(30 * 86_400_000); // November
    await recorder.record({ name: 'login' });
    const [a, b, c] = buffer();
    expect(a.installId).toBe(b.installId);
    expect(c.installId).not.toBe(a.installId);
  });

  it('records nothing without a platform (web) or for a store-review session', async () => {
    const web = setup({ platform: null });
    await web.recorder.record({ name: 'login' });
    expect(web.buffer()).toHaveLength(0);
    const review = setup({ context: () => ({ space: 'LICENSEE', storeReview: true }) });
    await review.recorder.record({ name: 'login' });
    expect(review.buffer()).toHaveLength(0);
  });

  it('recording never sends; a successful API response does, at most every 2 minutes', async () => {
    const { recorder, send, advance } = setup();
    await recorder.record({ name: 'login' });
    expect(send).not.toHaveBeenCalled();
    await recorder.onApiSuccess();
    expect(send).toHaveBeenCalledTimes(1);
    await recorder.record({ name: 'login' });
    advance(60_000);
    await recorder.onApiSuccess();
    expect(send).toHaveBeenCalledTimes(1); // < 2 min since the last flush
    advance(61_000);
    await recorder.onApiSuccess();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('background send only with an API success in the last 5 minutes', async () => {
    const { recorder, send, advance } = setup();
    await recorder.record({ name: 'login' });
    await recorder.onBackground();
    expect(send).not.toHaveBeenCalled(); // backend may be asleep
    await recorder.onApiSuccess(); // flush #1
    await recorder.record({ name: 'login' });
    advance(4 * 60_000);
    await recorder.onBackground(); // flush #2
    await recorder.record({ name: 'login' });
    advance(6 * 60_000);
    await recorder.onBackground(); // last success 10 min ago: no flush
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends at most 200 per batch and removes only what was sent', async () => {
    const { recorder, sent, buffer, advance } = setup();
    for (let i = 0; i < 250; i++) await recorder.record({ name: 'login' });
    await recorder.onApiSuccess();
    expect(sent[0]).toHaveLength(200);
    expect(buffer()).toHaveLength(50);
    advance(121_000);
    await recorder.onApiSuccess();
    expect(buffer()).toHaveLength(0);
  });

  it.each([0, 500, 503, 429])('keeps the batch when the send fails with %p', async (status) => {
    const { recorder, buffer } = setup({ send: jest.fn(async () => status) });
    await recorder.record({ name: 'login' });
    await recorder.onApiSuccess();
    expect(buffer()).toHaveLength(1);
  });

  it('drops the batch on 400 (invalid data never loops)', async () => {
    const { recorder, buffer } = setup({ send: jest.fn(async () => 400) });
    await recorder.record({ name: 'login' });
    await recorder.onApiSuccess();
    expect(buffer()).toHaveLength(0);
  });

  it('opt-out clears buffer and ID and stops recording; opt-in draws a new ID', async () => {
    const { recorder, storage, buffer } = setup();
    await recorder.record({ name: 'login' });
    const firstId = buffer()[0].installId;
    await recorder.setEnabled(false);
    expect(storage.map.has(USAGE_KEYS.buffer)).toBe(false);
    expect(storage.map.has(USAGE_KEYS.install)).toBe(false);
    expect(await recorder.isEnabled()).toBe(false);
    await recorder.record({ name: 'login' });
    expect(buffer()).toHaveLength(0);
    await recorder.setEnabled(true);
    await recorder.record({ name: 'login' });
    expect(buffer()[0].installId).not.toBe(firstId);
  });

  it('an empty buffer sends nothing', async () => {
    const { recorder, send } = setup();
    await recorder.onApiSuccess();
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter client exec jest src/services/analytics/__tests__/usageRecorder.test.ts`
Expected: FAIL, cannot find module `../usageRecorder`.

- [ ] **Step 3: Implement**

```ts
// apps/client/src/services/analytics/usageRecorder.ts
/**
 * Mesure d'audience anonyme (lot 5). Tampon local + identifiant d'installation
 * aléatoire renouvelé chaque mois, jamais lié au compte. L'envoi ne se fait
 * QUE quand le backend est déjà réveillé (juste après une réponse API réussie,
 * ou au passage en arrière-plan si une réponse a réussi il y a moins de 5 min) :
 * jamais de minuterie, jamais de réveil du backend scale-to-zero.
 */
import type { AnalyticsEventName } from './types';

export type UsageSpace = 'LICENSEE' | 'CLUB' | 'STAFF' | 'ADMIN' | 'GUEST';
export interface UsageContext {
  space: UsageSpace;
  storeReview: boolean;
}
export interface UsageInput {
  name: AnalyticsEventName;
  screen?: string;
  competitionId?: string;
  durationSec?: number;
  occurredAt?: Date;
}
export interface UsageRecord {
  installId: string;
  name: AnalyticsEventName;
  screen?: string;
  occurredAt: string;
  platform: 'ios' | 'android';
  appVersion: string;
  space: UsageSpace;
  competitionId?: string;
  durationSec?: number;
}
export interface UsageStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface UsageDeps {
  storage: UsageStorage;
  now(): Date;
  random(): number;
  /** null on web: nothing is recorded. */
  platform: 'ios' | 'android' | null;
  appVersion: string;
  context(): UsageContext;
  /** POSTs the batch; resolves the HTTP status (0 on network error). */
  send(events: UsageRecord[]): Promise<number>;
}
export interface UsageRecorder {
  record(input: UsageInput): Promise<void>;
  /** Marks the backend awake; resolves when the flush it may trigger is done. */
  onApiSuccess(): Promise<void>;
  onBackground(): Promise<void>;
  setEnabled(on: boolean): Promise<void>;
  isEnabled(): Promise<boolean>;
  clear(): Promise<void>;
}

export const USAGE_KEYS = {
  buffer: 'usage_buffer',
  install: 'usage_install',
  optOut: 'usage_opt_out',
} as const;
export const USAGE_LIMITS = {
  buffer: 500,
  batch: 200,
  flushEveryMs: 120_000,
  backgroundWindowMs: 300_000,
  maxDurationSec: 1800,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCREEN = /^[A-Za-z0-9_]{1,64}$/;

/** UUID v4 from a uniform random source: not a secret, only a counting key. */
export function uuidV4(random: () => number): string {
  const h = Array.from({ length: 32 }, () => Math.floor(random() * 16));
  h[12] = 4;
  h[16] = (h[16] & 0x3) | 0x8;
  const s = h.map((x) => x.toString(16)).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const toMinute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString();

export function createUsageRecorder(deps: UsageDeps): UsageRecorder {
  const { storage } = deps;
  let lastSuccessAt = Number.NEGATIVE_INFINITY;
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  // Serialises every storage read-modify-write (record, flush, opt-out).
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const readBuffer = async (): Promise<UsageRecord[]> => {
    try {
      const raw = await storage.getItem(USAGE_KEYS.buffer);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as UsageRecord[]) : [];
    } catch {
      return [];
    }
  };
  const writeBuffer = (events: UsageRecord[]) =>
    events.length
      ? storage.setItem(USAGE_KEYS.buffer, JSON.stringify(events))
      : storage.removeItem(USAGE_KEYS.buffer);

  const isEnabled = async () => (await storage.getItem(USAGE_KEYS.optOut)) !== '1';

  const installId = async (now: Date): Promise<string> => {
    const month = monthOf(now);
    try {
      const raw = await storage.getItem(USAGE_KEYS.install);
      const saved = raw ? (JSON.parse(raw) as { id?: string; month?: string }) : null;
      if (saved?.id && saved.month === month) return saved.id;
    } catch {
      // corrupted entry: draw a new one
    }
    const id = uuidV4(deps.random);
    await storage.setItem(USAGE_KEYS.install, JSON.stringify({ id, month }));
    return id;
  };

  const record = (input: UsageInput) =>
    serial(async () => {
      if (!deps.platform) return;
      const ctx = deps.context();
      if (ctx.storeReview || !(await isEnabled())) return;
      const now = deps.now();
      const event: UsageRecord = {
        installId: await installId(now),
        name: input.name,
        occurredAt: toMinute(input.occurredAt ?? now),
        platform: deps.platform,
        appVersion: deps.appVersion,
        space: ctx.space,
      };
      if (input.screen && SCREEN.test(input.screen)) event.screen = input.screen;
      if (input.competitionId && UUID.test(input.competitionId)) {
        event.competitionId = input.competitionId;
      }
      if (input.durationSec !== undefined) {
        event.durationSec = Math.max(
          0,
          Math.min(USAGE_LIMITS.maxDurationSec, Math.round(input.durationSec)),
        );
      }
      const buffer = await readBuffer();
      buffer.push(event);
      await writeBuffer(buffer.slice(-USAGE_LIMITS.buffer));
    });

  const flush = () =>
    serial(async () => {
      const buffer = await readBuffer();
      if (!buffer.length) return;
      const batch = buffer.slice(0, USAGE_LIMITS.batch);
      // The 2-minute spacing counts from the attempt: a failing backend is not hammered.
      lastFlushAt = deps.now().getTime();
      const status = await deps.send(batch).catch(() => 0);
      if ((status >= 200 && status < 300) || status === 400) {
        await writeBuffer(buffer.slice(batch.length));
      }
    });

  return {
    record,
    isEnabled,
    onApiSuccess() {
      const now = deps.now().getTime();
      lastSuccessAt = now;
      return now - lastFlushAt >= USAGE_LIMITS.flushEveryMs ? flush() : Promise.resolve();
    },
    onBackground() {
      return deps.now().getTime() - lastSuccessAt <= USAGE_LIMITS.backgroundWindowMs
        ? flush()
        : Promise.resolve();
    },
    setEnabled: (on) =>
      serial(async () => {
        if (on) {
          await storage.removeItem(USAGE_KEYS.optOut);
          return;
        }
        await storage.setItem(USAGE_KEYS.optOut, '1');
        await storage.removeItem(USAGE_KEYS.buffer);
        await storage.removeItem(USAGE_KEYS.install);
      }),
    clear: () => serial(() => storage.removeItem(USAGE_KEYS.buffer)),
  };
}
```

`flush` runs inside `serial`, so no `record` can interleave between the read and the write: writing `buffer.slice(batch.length)` cannot lose an event recorded during the send.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter client exec jest src/services/analytics/__tests__/usageRecorder.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/services/analytics/usageRecorder.ts apps/client/src/services/analytics/__tests__/usageRecorder.test.ts
git commit -m "feat(client): anonymous usage recorder with awake-only batching"
```

---

### Task 6: Client wiring (analytics service, screen durations, HTTP hooks, app state, context)

**Files:**

- Create: `apps/client/src/services/analytics/usage.ts`
- Modify: `apps/client/src/services/analytics/AnalyticsService.ts`, `apps/client/src/services/analytics/index.ts`
- Modify: `apps/client/src/services/api.ts`, `apps/client/src/api/client.ts`
- Modify: `apps/client/src/features/auth/services/AuthService.ts`, `apps/client/src/features/auth/context/AuthContext.tsx`
- Modify: `apps/client/App.tsx`
- Test: `apps/client/src/services/analytics/__tests__/usage.test.ts`, `apps/client/src/services/analytics/__tests__/AnalyticsService.test.ts` (rewrite), `apps/client/src/services/__tests__/apiUsageHook.test.ts`, the existing `AuthService` test file

**Interfaces:**

- Consumes: `createUsageRecorder`, `UsageContext`, `UsageRecord`, `UsageSpace`, `UsageInput` (Task 5); `BACKEND_URL`, `APP_VERSION` (`src/config.ts`).
- Produces:
  - `sendUsageBatch(events: UsageRecord[]): Promise<number>` (plain fetch, no `Authorization`)
  - `usage: { recorder: UsageRecorder; contextFromConfig(c: { isLoggedIn: boolean; isGuest?: boolean; role: string; isStoreReview?: boolean }): UsageContext; setContext(c: Partial<UsageContext>): void; onApiSuccess(): void; start(onBackground: () => void): () => void }`
  - `createAnalytics(deps: { dev: boolean; now(): Date; record(input: UsageInput): Promise<void> }): AnalyticsWithScreens`; `analytics` keeps `logEvent` / `logScreenView` and adds `endScreen()`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/client/src/services/analytics/__tests__/usage.test.ts
import { sendUsageBatch, usage } from '../usage';

describe('usage context', () => {
  it('derives the space and the store-review flag from the auth config', () => {
    expect(usage.contextFromConfig({ isLoggedIn: false, role: 'LICENSEE' })).toEqual({
      space: 'GUEST',
      storeReview: false,
    });
    expect(usage.contextFromConfig({ isLoggedIn: true, isGuest: true, role: 'LICENSEE' })).toEqual({
      space: 'GUEST',
      storeReview: false,
    });
    expect(
      usage.contextFromConfig({ isLoggedIn: true, role: 'CLUB', isStoreReview: true }),
    ).toEqual({
      space: 'CLUB',
      storeReview: true,
    });
  });
});

describe('sendUsageBatch', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('POSTs JSON without any Authorization header and returns the status', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(sendUsageBatch([])).resolves.toBe(204);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/analytics\/events$/);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ events: [] }));
  });

  it('resolves 0 on a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(sendUsageBatch([])).resolves.toBe(0);
  });
});
```

```ts
// apps/client/src/services/analytics/__tests__/AnalyticsService.test.ts
import { createAnalytics } from '../AnalyticsService';
import type { UsageInput } from '../usageRecorder';

function setup(dev = false) {
  const recorded: UsageInput[] = [];
  let now = new Date('2026-10-10T08:00:00Z');
  const analytics = createAnalytics({
    dev,
    now: () => now,
    record: async (input) => {
      recorded.push(input);
    },
  });
  const advance = (seconds: number) => {
    now = new Date(now.getTime() + seconds * 1000);
  };
  return { analytics, recorded, advance };
}

describe('AnalyticsService', () => {
  it('records events with their competition id only', () => {
    const { analytics, recorded } = setup();
    analytics.logEvent('competition_view', {
      competition_id: '00000000-0000-4000-8000-000000000000',
      screen_name: 'X',
    });
    analytics.logEvent('login', { method: 'email' });
    expect(recorded).toEqual([
      { name: 'competition_view', competitionId: '00000000-0000-4000-8000-000000000000' },
      { name: 'login' },
    ]);
  });

  it('records a screen view when it ends, with its start time and duration', () => {
    const { analytics, recorded, advance } = setup();
    analytics.logScreenView('Home');
    expect(recorded).toHaveLength(0);
    advance(42);
    analytics.logScreenView('Competitions');
    expect(recorded).toEqual([
      {
        name: 'screen_view',
        screen: 'Home',
        occurredAt: new Date('2026-10-10T08:00:00Z'),
        durationSec: 42,
      },
    ]);
    advance(10);
    analytics.endScreen();
    expect(recorded[1]).toMatchObject({
      name: 'screen_view',
      screen: 'Competitions',
      durationSec: 10,
    });
    analytics.endScreen(); // nothing pending
    expect(recorded).toHaveLength(2);
  });

  it('in dev, logs only and records nothing', () => {
    const { analytics, recorded } = setup(true);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    analytics.logEvent('login', { method: 'email' });
    analytics.logScreenView('Home');
    analytics.endScreen();
    expect(recorded).toHaveLength(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter client exec jest src/services/analytics`
Expected: FAIL — `../usage` missing, `createAnalytics` not exported.

- [ ] **Step 3: Implement `usage.ts` and the analytics service**

```ts
// apps/client/src/services/analytics/usage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { APP_VERSION, BACKEND_URL } from '../../config';
import {
  createUsageRecorder,
  type UsageContext,
  type UsageRecord,
  type UsageSpace,
} from './usageRecorder';

let context: UsageContext = { space: 'GUEST', storeReview: false };

/** Plain fetch: no auth header, outside the axios wake-and-replay interceptor. */
export async function sendUsageBatch(events: UsageRecord[]): Promise<number> {
  try {
    const res = await fetch(`${BACKEND_URL}/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    return res.status;
  } catch {
    return 0;
  }
}

const recorder = createUsageRecorder({
  storage: AsyncStorage,
  now: () => new Date(),
  random: Math.random,
  platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null,
  appVersion: APP_VERSION || '0',
  context: () => context,
  send: sendUsageBatch,
});

interface ConfigLike {
  isLoggedIn: boolean;
  isGuest?: boolean;
  role: string;
  isStoreReview?: boolean;
}
const SPACES: readonly string[] = ['LICENSEE', 'CLUB', 'STAFF', 'ADMIN', 'GUEST'];

export const usage = {
  recorder,
  contextFromConfig(config: ConfigLike): UsageContext {
    const role = SPACES.includes(config.role) ? (config.role as UsageSpace) : 'GUEST';
    return {
      space: !config.isLoggedIn || config.isGuest ? 'GUEST' : role,
      storeReview: config.isStoreReview === true,
    };
  },
  setContext(next: Partial<UsageContext>): void {
    const wasReview = context.storeReview;
    context = { ...context, ...next };
    if (!wasReview && context.storeReview) void recorder.clear();
  },
  onApiSuccess(): void {
    void recorder.onApiSuccess();
  },
  /** On background: close the pending screen view, then flush if awake. Returns an unsubscribe. */
  start(onBackground: () => void): () => void {
    const sub = AppState.addEventListener('change', (status) => {
      if (status !== 'background') return;
      onBackground();
      void recorder.onBackground();
    });
    return () => sub.remove();
  },
};
```

```ts
// apps/client/src/services/analytics/AnalyticsService.ts
/**
 * Analytics produit. En __DEV__ : log console. Hors dev : mesure d'audience
 * anonyme (lot 5, `usage.ts`), désactivable dans Réglages.
 */
import type { AnalyticsEventName, AnalyticsEventParams, IAnalytics } from './types';
import type { UsageInput } from './usageRecorder';

interface AnalyticsDeps {
  dev: boolean;
  now(): Date;
  record(input: UsageInput): Promise<void>;
}

export interface AnalyticsWithScreens extends IAnalytics {
  /** Closes the screen view in progress (app going to the background). */
  endScreen(): void;
}

export function createAnalytics(deps: AnalyticsDeps): AnalyticsWithScreens {
  let current: { screen: string; startedAt: Date } | null = null;

  const record = (input: UsageInput) => {
    void deps.record(input).catch(() => undefined);
  };

  const endScreen = () => {
    if (!current) return;
    const { screen, startedAt } = current;
    current = null;
    record({
      name: 'screen_view',
      screen,
      occurredAt: startedAt,
      durationSec: (deps.now().getTime() - startedAt.getTime()) / 1000,
    });
  };

  return {
    logEvent(name: AnalyticsEventName, params?: AnalyticsEventParams) {
      if (deps.dev) {
        // eslint-disable-next-line no-console
        console.log('[Analytics]', name, params ?? {});
        return;
      }
      const competitionId = params?.competition_id;
      record(typeof competitionId === 'string' ? { name, competitionId } : { name });
    },
    logScreenView(screenName: string, params?: AnalyticsEventParams) {
      if (deps.dev) {
        // eslint-disable-next-line no-console
        console.log('[Analytics] screen_view', { screen_name: screenName, ...params });
        return;
      }
      endScreen();
      current = { screen: screenName, startedAt: deps.now() };
    },
    endScreen,
  };
}

export const analytics: AnalyticsWithScreens = createAnalytics({
  dev: __DEV__,
  now: () => new Date(),
  // Lazy: keeps AsyncStorage / react-native out of modules that only log.
  record: async (input) => {
    const { usage } = await import('./usage');
    await usage.recorder.record(input);
  },
});
```

If jest-expo rejects the dynamic `import()`, use `require("./usage") as typeof import("./usage")` inside the function with `// eslint-disable-next-line @typescript-eslint/no-require-imports`; same behaviour. The previous `EXPO_PUBLIC_ANALYTICS_ENABLED` gate (a Firebase placeholder) is removed — the opt-out is the control (ledger it).

In `index.ts`: add `export { usage, sendUsageBatch } from "./usage";` and `export type { AnalyticsWithScreens } from "./AnalyticsService";`.

- [ ] **Step 4: Run the analytics tests**

Run: `pnpm --filter client exec jest src/services/analytics`
Expected: PASS.

- [ ] **Step 5: HTTP hooks (test first)**

```ts
// apps/client/src/services/__tests__/apiUsageHook.test.ts
import api from '../api';
import { usage } from '../analytics/usage';

describe('api → usage hook', () => {
  it('signals a successful response, not a failed one', async () => {
    const spy = jest.spyOn(usage, 'onApiSuccess').mockImplementation(() => undefined);
    const adapter = jest.fn(async (config) => {
      if (config.url === '/ok')
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      return Promise.reject(
        Object.assign(new Error('Not found'), {
          isAxiosError: true,
          config,
          response: { data: {}, status: 404, statusText: 'Not Found', headers: {}, config },
        }),
      );
    });
    await api.get('/ok', { adapter });
    await api.get('/ko', { adapter }).catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
```

Run it: FAIL (no call). Then in `apps/client/src/services/api.ts`, in the response success handler, before `return response;`, add `usage.onApiSuccess();` with `import { usage } from "./analytics/usage";`. Run: PASS. (If the per-request `adapter` option clashes with the file's retry wrapper, follow how the existing `src/services/__tests__` api tests stub axios; do not add a dependency.)

In `apps/client/src/api/client.ts`, after the existing response interceptor:

```ts
// Lot 5: a successful response proves the backend is awake — the only moment
// anonymous usage batches may be sent (never wakes the scale-to-zero app).
client.interceptors.response.use((response) => {
  if (response.ok) usage.onApiSuccess();
  return response;
});
```

with `import { usage } from "../services/analytics/usage";`.

- [ ] **Step 6: Context from the auth config (test first)**

In the existing AuthService test file (`grep -rln "syncRolesFromProfile" apps/client/src/features/auth`), add, using that file's setup for a logged-in config:

```ts
it('syncRolesFromProfile persists the store-review flag and marks the usage context', async () => {
  const next = await AuthService.syncRolesFromProfile({
    email: 'reviewer@example.com',
    role: 'LICENSEE',
    roles: ['LICENSEE'],
    isStoreReview: true,
  });
  expect(next.isStoreReview).toBe(true);
  expect(usage.contextFromConfig(next)).toEqual({ space: 'LICENSEE', storeReview: true });
});
```

(import `usage` from `services/analytics/usage` with the right relative path). Run: FAIL. Then in `AuthService.ts`:

- `import { usage } from "../../../services/analytics/usage";`
- `AuthConfig`: add `/** Account handed to store reviewers: no usage measurement. */ isStoreReview?: boolean;`
- `getAuthConfig`: build the merged config into a `const config`, call `usage.setContext(usage.contextFromConfig(config))`, return it.
- `saveAuthConfig`: call `usage.setContext(usage.contextFromConfig(config))` after saving.
- `syncRolesFromProfile`: parameter `Pick<UserProfile, "email" | "role" | "roles" | "isStoreReview">`; `const isStoreReview = profile.isStoreReview === true;`; add `&& config.isStoreReview === isStoreReview` to the unchanged-config early return; `next = { ...config, roles, mainRole: profile.role, role, isStoreReview }`.
- `login`: in the saved `newConfig`, set `isStoreReview: false` when the new username differs from the previous config's `username`.
  Mirror the `syncRolesFromProfile` signature in `AuthContext.tsx`'s `AuthRepository`. Run: PASS.

- [ ] **Step 7: Lifecycle in `App.tsx`**

```tsx
// Lot 5: on background, close the screen view and send usage if the backend is awake.
useEffect(() => usage.start(() => analytics.endScreen()), []);
```

with `import { analytics, usage } from "./src/services/analytics";`.

- [ ] **Step 8: Run client tests and typecheck**

```bash
pnpm --filter client exec jest src/services src/features/auth src/navigation
pnpm --filter client exec tsc --noEmit
```

Expected: PASS; no type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/client/src/services apps/client/src/api/client.ts apps/client/src/features/auth apps/client/App.tsx
git commit -m "feat(client): send anonymous usage only while the backend is awake"
```

---

### Task 7: Opt-out switch, privacy texts

**Files:**

- Modify: `apps/client/src/features/settings/components/SettingsPrivacySection.tsx`
- Modify: `apps/client/src/features/settings/hooks/useSettingsLogic.ts`
- Modify: `apps/client/src/features/settings/screens/SettingsScreen.tsx`
- Test: `apps/client/src/features/settings/components/__tests__/SettingsPrivacySection.test.tsx`
- Modify: `apps/client/src/features/legal/legalContent.ts`
- Modify: `docs/legal/politique-confidentialite.md`

**Interfaces:**

- Consumes: `usage.recorder.isEnabled()`, `usage.recorder.setEnabled(on)` (Tasks 5–6).
- Produces: `SettingsPrivacySection` props `usageEnabled: boolean | null` (null = loading, switch hidden), `onToggleUsage: (on: boolean) => void`.

- [ ] **Step 1: Failing component test**

```tsx
// apps/client/src/features/settings/components/__tests__/SettingsPrivacySection.test.tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { SettingsPrivacySection } from '../SettingsPrivacySection';

const theme = {
  textSecondary: '#666',
  surface: '#fff',
  text: '#000',
  border: '#ddd',
  primary: '#00f',
} as never;

type Props = React.ComponentProps<typeof SettingsPrivacySection>;
const renderSection = (o: Partial<Props> = {}) =>
  render(
    <SettingsPrivacySection
      theme={theme}
      isGuest={false}
      exporting={false}
      onExportData={jest.fn()}
      onDeleteAccount={jest.fn()}
      onOpenLegal={jest.fn()}
      usageEnabled
      onToggleUsage={jest.fn()}
      {...o}
    />,
  );

describe('SettingsPrivacySection — usage measurement', () => {
  it('shows the switch with its explanation, also for guests', () => {
    renderSection({ isGuest: true });
    expect(screen.getByText("Mesure d'audience anonyme")).toBeTruthy();
    expect(
      screen.getByText("Statistiques d'usage anonymes, sans lien avec votre compte."),
    ).toBeTruthy();
    expect(screen.getByTestId('settings-usage-switch').props.value).toBe(true);
  });

  it('toggling calls the handler with the new value', () => {
    const onToggleUsage = jest.fn();
    renderSection({ onToggleUsage });
    fireEvent(screen.getByTestId('settings-usage-switch'), 'valueChange', false);
    expect(onToggleUsage).toHaveBeenCalledWith(false);
  });

  it('hides the switch while the preference loads', () => {
    renderSection({ usageEnabled: null });
    expect(screen.queryByTestId('settings-usage-switch')).toBeNull();
  });
});
```

If rendering needs more theme keys, copy the theme fixture of `SettingsNotificationsSection.test.tsx`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter client exec jest src/features/settings/components/__tests__/SettingsPrivacySection.test.tsx`
Expected: FAIL — text not found.

- [ ] **Step 3: Implement**

In `SettingsPrivacySection.tsx`: import `BarChart3` (lucide-react-native) and `Switch` (react-native); add the two props to the interface and the destructuring; render as the first row of the card:

```tsx
{
  usageEnabled !== null && (
    <View style={styles.row}>
      <View style={[styles.rowLeft, { flex: 1 }]}>
        <View style={[styles.iconBox, { backgroundColor: '#8e44ad20' }]}>
          <BarChart3 size={20} color="#8e44ad" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Mesure d'audience anonyme</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
            Statistiques d'usage anonymes, sans lien avec votre compte.
          </Text>
        </View>
      </View>
      <Switch
        testID="settings-usage-switch"
        value={usageEnabled}
        onValueChange={onToggleUsage}
        accessibilityLabel="Mesure d'audience anonyme"
      />
    </View>
  );
}
```

Borders: the export row gets `usageEnabled !== null && [styles.borderTop, { borderTopColor: theme.border }]` in its `style` array; the legal rows' condition `(index > 0 || !isGuest)` becomes `(index > 0 || !isGuest || usageEnabled !== null)` in both places.

In `useSettingsLogic.ts`: `import { usage } from "../../../services/analytics/usage";`; add `const [usageEnabled, setUsageEnabled] = useState<boolean | null>(null);`; in the existing mount effect, `void usage.recorder.isEnabled().then(setUsageEnabled);`; add

```ts
const handleToggleUsage = useCallback(async (on: boolean) => {
  setUsageEnabled(on);
  await usage.recorder.setEnabled(on);
}, []);
```

and return `usageEnabled` and `handleToggleUsage` with the other values. In `SettingsScreen.tsx`, pass `usageEnabled` and `onToggleUsage={handleToggleUsage}` to `SettingsPrivacySection`, reading them from the hook the same way the screen reads its other values.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter client exec jest src/features/settings`
Expected: PASS (if a settings screen test asserts an exact list of rows or snapshots, update it for the new row).

- [ ] **Step 5: Privacy texts**

`docs/legal/politique-confidentialite.md`:

- §2 add: « **Données d'usage anonymes** (application mobile) : écrans consultés et durée, événements (connexion, inscription, scan de licence, ajout au Wallet, consultation d'une compétition), date et heure à la minute, plateforme, version de l'application, espace actif. Elles sont rattachées à un identifiant d'installation aléatoire renouvelé chaque mois, jamais à votre compte. »
- §3 table row: « Mesurer l'audience de l'application de façon anonyme | Intérêt légitime (mesure d'audience exemptée de consentement, recommandations CNIL) ».
- §5 add: « Données d'usage anonymes : 90 jours avec l'identifiant d'installation, puis statistiques agrégées sans identifiant conservées 25 mois. »
- §10: after « … strictement nécessaires au fonctionnement. », add « L'application mesure aussi son audience de façon anonyme, sans outil tiers : un identifiant d'installation aléatoire, renouvelé chaque mois et sans lien avec votre compte. Vous pouvez la désactiver à tout moment dans Réglages → Confidentialité et données → Mesure d'audience anonyme. » Keep the landing sentence.
- Date line updated to the current date in French; then `npx prettier --write docs/legal/politique-confidentialite.md`.

`apps/client/src/features/legal/legalContent.ts` (`privacy`): add the purpose to « Finalités et bases légales », the retention to « Durées de conservation », and the opt-out sentence to the section about cookies / trackers (or, if there is none, to the rights section); set `updatedAt` to the same French date. Update any `src/features/legal/__tests__` assertion on these texts.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/features/settings apps/client/src/features/legal docs/legal/politique-confidentialite.md
git commit -m "feat(client): anonymous usage opt-out in settings, privacy texts"
```

---

### Task 8: SPA « Usage de l'app » page

**Files:**

- Create: `apps/admin/src/lib/usage.ts`, `apps/admin/src/lib/usage.test.ts`
- Modify: `apps/admin/src/api/queries.ts`, `apps/admin/src/api/queries.test.ts`
- Create: `apps/admin/src/pages/UsagePage.tsx`, `apps/admin/src/pages/UsagePage.test.tsx`
- Modify: `apps/admin/src/router.tsx`, `apps/admin/src/components/AppLayout.tsx`, `apps/admin/src/components/AppLayout.test.tsx`

**Interfaces:**

- Consumes: generated `adminUsageControllerGet` and `AdminUsageDto` (Task 4 `api:sync`); lot 4 `bucketLabel` (`src/lib/stats.ts`); `UNAVAILABLE_MESSAGE`.
- Produces: `USAGE_PERIOD_OPTIONS`, `parseUsagePeriod(raw)`, `USAGE_SPACE_OPTIONS`, `parseUsageSpace(raw)`, `heatLevel(value, max)` (0–4), `DAY_LABELS`, `formatMinutes(min | null)`, `share(part, total)`, `frDate(iso)`; `usageQuery(period, space?)`; `UsagePage`.

- [ ] **Step 1: Failing helper and query tests**

```ts
// apps/admin/src/lib/usage.test.ts
import {
  DAY_LABELS,
  formatMinutes,
  frDate,
  heatLevel,
  parseUsagePeriod,
  parseUsageSpace,
  share,
} from './usage';

describe('usage helpers', () => {
  it('parses the period and the space from the URL', () => {
    expect(parseUsagePeriod('7d')).toBe('7d');
    expect(parseUsagePeriod('12m')).toBe('12m');
    expect(parseUsagePeriod(null)).toBe('30d');
    expect(parseUsagePeriod('1y')).toBe('30d');
    expect(parseUsageSpace('CLUB')).toBe('CLUB');
    expect(parseUsageSpace('ALL')).toBeUndefined();
    expect(parseUsageSpace('ROOT')).toBeUndefined();
    expect(parseUsageSpace(null)).toBeUndefined();
  });

  it('maps a cell to 5 levels relative to the largest cell', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(0, 0)).toBe(0);
  });

  it('labels days Monday first', () => {
    expect(DAY_LABELS).toEqual(['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']);
  });

  it('formats minutes, shares and dates', () => {
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(7.5)).toBe('7,5 min');
    expect(formatMinutes(90)).toBe('1 h 30');
    expect(share(1, 4)).toBe('25 %');
    expect(share(0, 0)).toBe('—');
    expect(frDate('2026-10-09')).toBe('09/10/2026');
  });
});
```

Add to `apps/admin/src/api/queries.test.ts` (and `usageQuery` to its import):

```ts
describe('usageQuery', () => {
  it('is keyed by period and space and never wakes the backend', () => {
    expect(usageQuery('7d', 'CLUB')).toMatchObject({
      queryKey: ['admin', 'usage', '7d', 'CLUB'],
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter admin exec vitest run src/lib/usage.test.ts src/api/queries.test.ts`
Expected: FAIL — `./usage` missing, `usageQuery` not exported.

- [ ] **Step 3: Implement helpers and query**

```ts
// apps/admin/src/lib/usage.ts
export type UsagePeriod = '7d' | '30d' | '12m';
export type UsageSpace = 'LICENSEE' | 'CLUB' | 'STAFF' | 'ADMIN' | 'GUEST';

export const USAGE_PERIOD_OPTIONS: { value: UsagePeriod; label: string }[] = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '12m', label: '12 mois' },
];

export const USAGE_SPACE_OPTIONS: { value: UsageSpace | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: 'LICENSEE', label: 'Licencié' },
  { value: 'CLUB', label: 'Club' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'GUEST', label: 'Invité' },
];

export function parseUsagePeriod(raw: string | null): UsagePeriod {
  return USAGE_PERIOD_OPTIONS.find((o) => o.value === raw)?.value ?? '30d';
}

export function parseUsageSpace(raw: string | null): UsageSpace | undefined {
  const found = USAGE_SPACE_OPTIONS.find((o) => o.value === raw);
  return found && found.value !== 'ALL' ? found.value : undefined;
}

export const DAY_LABELS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

/** 0 = empty, 1..4 = quarters of the largest cell. */
export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${decimal.format(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function share(part: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((part / total) * 100)} %`;
}

/** YYYY-MM-DD → JJ/MM/AAAA. */
export function frDate(iso: string): string {
  return iso.split('-').reverse().join('/');
}
```

In `queries.ts`: add `adminUsageControllerGet` to the SDK import, `import type { UsagePeriod, UsageSpace } from '../lib/usage';`, and:

```ts
/** Usage is computed on demand: no refetch on focus or reconnect, no retry (lot 5). */
export const usageQuery = (period: UsagePeriod, space?: UsageSpace) =>
  queryOptions({
    queryKey: ['admin', 'usage', period, space ?? 'ALL'],
    queryFn: () =>
      unwrap(adminUsageControllerGet({ query: space ? { period, space } : { period } })),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
```

Run Step 2's command → PASS; `pnpm --filter admin typecheck` → clean.

- [ ] **Step 4: Failing page tests**

```tsx
// apps/admin/src/pages/UsagePage.test.tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { UsagePage } from './UsagePage';

const grid = () => Array.from({ length: 7 }, () => Array<number>(24).fill(0));
const usage = (o: Record<string, unknown> = {}) => {
  const heatmap = grid();
  heatmap[0][9] = 8; // lun. 9 h
  heatmap[5][14] = 2; // sam. 14 h
  return {
    generatedAt: '2026-10-10T08:30:00.000Z',
    period: '30d',
    from: '2026-09-11',
    to: '2026-10-10',
    bucket: 'day',
    aggregatedUntil: null,
    activeInstallsPerDay: 4.5,
    activeInstallsThisMonth: 21,
    sessions: 37,
    medianSessionMinutes: 7.5,
    platforms: { ios: 30, android: 10 },
    heatmap,
    screens: [
      { screen: 'Competitions', views: 30, durationSec: 900 },
      { screen: 'License', views: 10, durationSec: 60 },
    ],
    events: [
      {
        start: '2026-10-10',
        login: 3,
        login_biometric: 1,
        login_guest: 0,
        register: 1,
        license_scan: 0,
        license_wallet_add: 0,
      },
    ],
    versions: [{ appVersion: '1.4.2', installs: 18 }],
    competitions: [
      { competitionId: 'c1', title: 'Open de Lyon', views: 12 },
      { competitionId: 'c2', title: null, views: 2 },
    ],
    ...o,
  };
};

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(path = '/usage') {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/usage"
              element={
                <>
                  <UsagePage />
                  <Probe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}
const ok = (data: object) => ({ data, error: undefined }) as never;

describe('UsagePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the figures, the day × hour grid with its accessible table, and the tables', async () => {
    vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue(ok(usage()));
    renderPage();
    expect(await screen.findByText('Installations actives / jour')).toBeInTheDocument();
    expect(screen.getByText('4,5')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('7,5 min')).toBeInTheDocument();
    expect(screen.getByText('75 % / 25 %')).toBeInTheDocument();
    expect(screen.getByTitle('lun. 9 h : 8')).toHaveAttribute('data-level', '4');
    expect(screen.getByTitle('sam. 14 h : 2')).toHaveAttribute('data-level', '1');
    const a11y = screen.getByRole('table', { name: 'Usage par jour et heure' });
    expect(within(a11y).getAllByRole('row')).toHaveLength(8); // header + 7 days
    expect(screen.getByText('Competitions')).toBeInTheDocument();
    expect(screen.getByText('15 min')).toBeInTheDocument(); // 900 s
    expect(screen.getByText('1.4.2')).toBeInTheDocument();
    expect(screen.getByText('Open de Lyon')).toBeInTheDocument();
    expect(screen.getByText('Compétition supprimée')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Données anonymes : un identifiant d'installation renouvelé chaque mois, sans lien avec les comptes. Les utilisateurs qui ont désactivé la mesure d'audience n'apparaissent pas.",
      ),
    ).toBeInTheDocument();
  });

  it('period and space go to the URL and the request', async () => {
    const get = vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue(ok(usage()));
    renderPage();
    await screen.findByText('Installations actives / jour');
    expect(get).toHaveBeenLastCalledWith({ query: { period: '30d' } });
    await userEvent.click(screen.getByRole('radio', { name: '7 jours' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ query: { period: '7d' } }));
    await userEvent.click(screen.getByRole('radio', { name: 'Club' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith({ query: { period: '7d', space: 'CLUB' } }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/usage?period=7d&space=CLUB');
  });

  it('12m shows the aggregation date, « — » for sessions and the 90-day note', async () => {
    vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue(
      ok(
        usage({
          period: '12m',
          bucket: 'month',
          aggregatedUntil: '2026-10-09',
          sessions: null,
          medianSessionMinutes: null,
        }),
      ),
    );
    renderPage('/usage?period=12m');
    expect(await screen.findByText("Données agrégées jusqu'au 09/10/2026")).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('90 derniers jours')).toBeInTheDocument();
  });

  it('an empty period shows the empty state', async () => {
    vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue(
      ok(
        usage({
          heatmap: grid(),
          screens: [],
          versions: [],
          competitions: [],
          sessions: 0,
          medianSessionMinutes: null,
          activeInstallsPerDay: 0,
          activeInstallsThisMonth: 0,
          platforms: { ios: 0, android: 0 },
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText("Aucune donnée d'usage sur la période.")).toBeInTheDocument();
  });

  it('shows the shared error alert', async () => {
    vi.spyOn(sdk, 'adminUsageControllerGet').mockResolvedValue({
      data: undefined,
      error: { statusCode: 500 },
    } as never);
    renderPage();
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm --filter admin exec vitest run src/pages/UsagePage.test.tsx`
Expected: FAIL, cannot resolve `./UsagePage`.

- [ ] **Step 6: Implement the page**

```tsx
// apps/admin/src/pages/UsagePage.tsx
import '@mantine/charts/styles.css';
import { BarChart } from '@mantine/charts';
import {
  Alert,
  Box,
  Button,
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { AdminUsageDto } from '../api/generated/types.gen';
import { usageQuery } from '../api/queries';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { bucketLabel } from '../lib/stats';
import {
  DAY_LABELS,
  formatMinutes,
  frDate,
  heatLevel,
  parseUsagePeriod,
  parseUsageSpace,
  share,
  USAGE_PERIOD_OPTIONS,
  USAGE_SPACE_OPTIONS,
} from '../lib/usage';

const FOOTER =
  "Données anonymes : un identifiant d'installation renouvelé chaque mois, sans lien avec les comptes. Les utilisateurs qui ont désactivé la mesure d'audience n'apparaissent pas.";
const HEAT = [
  'var(--mantine-color-gray-1)',
  'var(--mantine-color-blue-2)',
  'var(--mantine-color-blue-4)',
  'var(--mantine-color-blue-6)',
  'var(--mantine-color-blue-8)',
];
const EVENT_SERIES = [
  { name: 'login', label: 'Connexions', color: 'blue.6' },
  { name: 'login_biometric', label: 'Biométrie', color: 'cyan.6' },
  { name: 'login_guest', label: 'Invités', color: 'gray.6' },
  { name: 'register', label: 'Inscriptions', color: 'teal.6' },
  { name: 'license_scan', label: 'Scans de licence', color: 'orange.6' },
  { name: 'license_wallet_add', label: 'Ajouts Wallet', color: 'grape.6' },
];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="xl">
        {value}
      </Text>
    </Card>
  );
}

function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(0, ...grid.flat());
  return (
    <Stack gap={4}>
      <Text fw={500}>Jour × heure</Text>
      <Box style={{ overflowX: 'auto' }}>
        <Box
          aria-hidden="true"
          style={{
            display: 'grid',
            gridTemplateColumns: '3rem repeat(24, minmax(14px, 1fr))',
            gap: 2,
            minWidth: 420,
          }}
        >
          <span />
          {HOURS.map((h) => (
            <Text key={h} size="xs" c="dimmed" ta="center">
              {h % 3 === 0 ? h : ''}
            </Text>
          ))}
          {grid.map((row, d) => [
            <Text key={`label-${d}`} size="xs" c="dimmed">
              {DAY_LABELS[d]}
            </Text>,
            ...row.map((value, h) => {
              const level = heatLevel(value, max);
              return (
                <div
                  key={`${d}-${h}`}
                  title={`${DAY_LABELS[d]} ${h} h : ${value}`}
                  data-level={level}
                  style={{ height: 18, borderRadius: 3, background: HEAT[level] }}
                />
              );
            }),
          ])}
        </Box>
      </Box>
      <VisuallyHidden>
        <table aria-label="Usage par jour et heure">
          <thead>
            <tr>
              <th>Jour</th>
              {HOURS.map((h) => (
                <th key={h}>{h} h</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, d) => (
              <tr key={d}>
                <th>{DAY_LABELS[d]}</th>
                {row.map((v, h) => (
                  <td key={h}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </VisuallyHidden>
    </Stack>
  );
}

const isEmpty = (u: AdminUsageDto) =>
  u.screens.length === 0 && u.heatmap.every((row) => row.every((v) => v === 0));

function UsageContent({ u }: { u: AdminUsageDto }) {
  const platformTotal = u.platforms.ios + u.platforms.android;
  const viewTotal = u.screens.reduce((s, r) => s + r.views, 0);
  const events = u.events.map((e) => ({
    ...e,
    label: bucketLabel(e.start, u.bucket === 'month' ? 'month' : 'week'),
  }));
  return (
    <Stack gap="xl">
      <SimpleGrid cols={{ base: 2, sm: 5 }}>
        <Figure
          label="Installations actives / jour"
          value={decimal.format(u.activeInstallsPerDay)}
        />
        <Figure label="Installations actives ce mois" value={u.activeInstallsThisMonth} />
        <Figure label="Sessions" value={u.sessions ?? '—'} />
        <Figure label="Durée médiane d'une session" value={formatMinutes(u.medianSessionMinutes)} />
        <Figure
          label="iOS / Android"
          value={
            platformTotal
              ? `${share(u.platforms.ios, platformTotal)} / ${share(u.platforms.android, platformTotal)}`
              : '—'
          }
        />
      </SimpleGrid>

      {isEmpty(u) ? (
        <Text c="dimmed">Aucune donnée d'usage sur la période.</Text>
      ) : (
        <>
          <Heatmap grid={u.heatmap} />
          <Stack gap={4}>
            <Text fw={500}>Événements clés</Text>
            <div aria-hidden="true">
              <BarChart
                h={200}
                data={events}
                dataKey="label"
                type="stacked"
                series={EVENT_SERIES}
                withLegend
              />
            </div>
          </Stack>
        </>
      )}

      <Stack gap="xs">
        <Title order={3}>Écrans</Title>
        <Table.ScrollContainer minWidth={420}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Écran</Table.Th>
                <Table.Th>Vues</Table.Th>
                <Table.Th>Temps total</Table.Th>
                <Table.Th>Part</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {u.screens.map((s) => (
                <Table.Tr key={s.screen}>
                  <Table.Td>{s.screen}</Table.Td>
                  <Table.Td>{s.views}</Table.Td>
                  <Table.Td>{formatMinutes(Math.round(s.durationSec / 6) / 10)}</Table.Td>
                  <Table.Td>{share(s.views, viewTotal)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Stack gap="xs">
          <Title order={3}>Versions (7 derniers jours)</Title>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Version</Table.Th>
                <Table.Th>Installations</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {u.versions.map((v) => (
                <Table.Tr key={v.appVersion}>
                  <Table.Td>{v.appVersion}</Table.Td>
                  <Table.Td>{v.installs}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
        <Stack gap="xs">
          <Title order={3}>Compétitions les plus vues</Title>
          {u.period === '12m' ? (
            <Text size="sm" c="dimmed">
              90 derniers jours
            </Text>
          ) : null}
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Compétition</Table.Th>
                <Table.Th>Vues</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {u.competitions.map((c) => (
                <Table.Tr key={c.competitionId}>
                  <Table.Td>{c.title ?? 'Compétition supprimée'}</Table.Td>
                  <Table.Td>{c.views}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </SimpleGrid>

      <Text size="sm" c="dimmed">
        {FOOTER}
      </Text>
    </Stack>
  );
}

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const period = parseUsagePeriod(params.get('period'));
  const space = parseUsageSpace(params.get('space'));
  const usage = useQuery(usageQuery(period, space));
  const update = (key: 'period' | 'space', value: string) => {
    const next = new URLSearchParams(params);
    if (key === 'period') next.set('period', value);
    if (key === 'space') {
      if (!next.has('period')) next.set('period', period);
      if (value === 'ALL') next.delete('space');
      else next.set('space', value);
    }
    setParams(next);
  };
  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Usage de l'app</Title>
        <Group wrap="wrap">
          <SegmentedControl
            value={period}
            data={USAGE_PERIOD_OPTIONS}
            onChange={(v) => update('period', v)}
          />
          <Button variant="default" onClick={() => void usage.refetch()} loading={usage.isFetching}>
            Actualiser
          </Button>
        </Group>
      </Group>
      <Group wrap="wrap" gap="xs">
        <Text size="sm">Écrans de l'espace :</Text>
        <SegmentedControl
          size="xs"
          value={space ?? 'ALL'}
          data={USAGE_SPACE_OPTIONS}
          onChange={(v) => update('space', v)}
        />
      </Group>
      {usage.data?.period === '12m' && usage.data.aggregatedUntil ? (
        <Text size="sm" c="dimmed">
          Données agrégées jusqu'au {frDate(usage.data.aggregatedUntil)}
        </Text>
      ) : null}
      {usage.isError ? (
        <Alert color="red">{UNAVAILABLE_MESSAGE}</Alert>
      ) : usage.data ? (
        <UsageContent u={usage.data} />
      ) : (
        <Stack>
          <Skeleton h={80} />
          <Skeleton h={200} />
        </Stack>
      )}
    </Stack>
  );
}
```

`bucketLabel(start, 'week')` prints « 5 oct. », which is the label wanted for a day. If the generated `AdminUsageDto.bucket` is typed `string`, the `=== 'month'` comparison above already narrows it.

- [ ] **Step 7: Run page tests**

Run: `pnpm --filter admin exec vitest run src/pages/UsagePage.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 8: Lazy route and menu (test first)**

In `AppLayout.test.tsx`, after the « Statistiques » assertion:

```tsx
expect(screen.getByRole('link', { name: "Usage de l'app" })).toHaveAttribute('href', '/usage');
```

Run it: FAIL. Then `AppLayout.tsx`, after the « Statistiques » link:

```tsx
<NavLink component={RouterLink} to="/usage" label="Usage de l'app" />
```

and `router.tsx`, after the `stats` route:

```tsx
      {
        path: 'usage',
        // Lazy: shares the charts chunk with /stats, out of the main bundle.
        lazy: () => import('./pages/UsagePage').then((m) => ({ Component: m.UsagePage })),
      },
```

Run: PASS.

- [ ] **Step 9: SPA suite, typecheck, lint, build**

```bash
pnpm --filter admin exec vitest run --testTimeout=30000
pnpm --filter admin typecheck && pnpm --filter admin lint && pnpm --filter admin build
ls apps/admin/dist/assets | grep -i usage
```

Expected: all green; a `UsagePage-*.js` chunk. (The 30 s timeout only compensates a loaded machine; CI keeps the default.)

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/lib/usage.ts apps/admin/src/lib/usage.test.ts apps/admin/src/api/queries.ts apps/admin/src/api/queries.test.ts apps/admin/src/pages/UsagePage.tsx apps/admin/src/pages/UsagePage.test.tsx apps/admin/src/router.tsx apps/admin/src/components/AppLayout.tsx apps/admin/src/components/AppLayout.test.tsx
git commit -m "feat(admin-spa): « Usage de l'app » page with day × hour grid"
```

---

### Task 9: Full verification

**Files:** none new (fixes only).

- [ ] **Step 1: Preflight** — `cd /Users/gabin/Development/FFD-Connect-lot5 && pnpm preflight > <workspace>/preflight.log 2>&1; echo "exit $?"`. Expected exit 0. Known flake: client `TrackCorrectionsReviewScreen` under machine load — if it is the only failure, rerun it alone and record both results.
- [ ] **Step 2: Real-DB and e2e** (test-DB env):
  ```bash
  cd apps/backend
  npx prisma db push
  npx jest --config ./test/jest-integration.json --runInBand --forceExit test/usage.integration-spec.ts test/admin-stats.integration-spec.ts
  pnpm test:e2e -- test/admin.e2e-spec.ts test/analytics.e2e-spec.ts
  ```
  Expected: PASS.
- [ ] **Step 3: Swagger freshness** — rerun the Swagger command; `git status --porcelain apps/backend/swagger.json` prints nothing.
- [ ] **Step 4: No-wake audit**
  ```bash
  grep -rn "analytics/events" apps/client/src | grep -v __tests__
  grep -rn "wakeBackend\|setInterval\|setTimeout" apps/client/src/services/analytics || echo "no timers, no wake"
  ```
  Expected: only `usage.ts` posts to `analytics/events`; « no timers, no wake ».
- [ ] **Step 5: Commit any fix** (`fix:` / `chore:`); nothing to commit if clean.
