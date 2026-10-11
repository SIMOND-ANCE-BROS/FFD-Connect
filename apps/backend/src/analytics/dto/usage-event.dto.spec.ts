import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UsageBatchDto } from "./usage-event.dto";

const event = (o: Record<string, unknown> = {}) => ({
  installId: "4b0f8a2e-1c3d-4e5f-9a6b-7c8d9e0f1a2b",
  name: "screen_view",
  screen: "CompetitionDetail",
  occurredAt: "2026-10-10T08:15:00.000Z",
  platform: "ios",
  appVersion: "1.4.2",
  space: "LICENSEE",
  competitionId: "00000000-0000-4000-8000-000000000000",
  durationSec: 42,
  ...o,
});

const errorsFor = async (body: unknown) =>
  validate(plainToInstance(UsageBatchDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe("UsageBatchDto", () => {
  it("accepts a valid batch, optional fields absent", async () => {
    const minimal: Record<string, unknown> = event();
    delete minimal.screen;
    delete minimal.competitionId;
    delete minimal.durationSec;
    expect(await errorsFor({ events: [event(), minimal] })).toHaveLength(0);
  });

  it.each([
    ["installId", "not-a-uuid"],
    ["installId", "4b0f8a2e-1c3d-1e5f-9a6b-7c8d9e0f1a2b"], // v1, not v4
    ["name", "purchase"],
    ["screen", "Bad Screen!"],
    ["screen", "x".repeat(65)],
    ["occurredAt", "yesterday"],
    ["platform", "web"],
    ["appVersion", "1.4.2 beta"],
    ["appVersion", "1".repeat(21)],
    ["space", "SUPERADMIN"],
    ["competitionId", "42"],
    ["durationSec", -1],
    ["durationSec", 1801],
    ["durationSec", 1.5],
  ])("rejects %s = %p", async (field, value) => {
    const errors = await errorsFor({ events: [event({ [field]: value })] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects an unknown property", async () => {
    const errors = await errorsFor({ events: [event({ userId: "u1" })] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects 0 and 201 events", async () => {
    expect((await errorsFor({ events: [] })).length).toBeGreaterThan(0);
    const many = Array.from({ length: 201 }, () => event());
    expect((await errorsFor({ events: many })).length).toBeGreaterThan(0);
  });
});
