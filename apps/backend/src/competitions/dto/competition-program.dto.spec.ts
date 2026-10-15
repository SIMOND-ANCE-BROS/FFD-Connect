import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from "@nestjs/common";
import { ReplaceCompetitionProgramDto } from "./competition-program.dto";

/**
 * Contract between the club competition editor (apps/client, #442) and
 * PUT /competitions/:id/program, checked with the ValidationPipe options of
 * main.ts.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const meta: ArgumentMetadata = {
  type: "body",
  metatype: ReplaceCompetitionProgramDto,
  data: "",
};

const messagesOf = async (body: Record<string, unknown>): Promise<string[]> => {
  try {
    await pipe.transform(body, meta);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { message: string[] }).message;
  }
};

/** What the editor sends for a typical programme. */
const editorPayload = {
  events: [
    {
      eventKind: "CLASSIFICATRICE",
      eventType: "COUPLE",
      category: "Latine",
      ageGroup: "Adulte",
      level: "Intermédiaire",
    },
    {
      id: "0b6a3c1e-3f9e-4a57-9e43-0c2a4a3e1f00",
      eventKind: "OPEN",
      eventType: "COUPLE",
      category: "Standard",
      ageGroup: "Youth",
      ageGroups: ["Youth", "Adulte"],
      openLevels: [],
      level: null,
    },
    {
      // imported from the FFD, sent back as is
      id: "ffd-event",
      eventKind: null,
      eventType: "COUPLE",
      category: "Latin",
      ageGroup: "Adult",
      level: null,
    },
  ],
  schedule: [
    {
      startTime: "10:00",
      durationMinutes: 15,
      type: "ROUND",
      title: "Latines Adulte — 1/4 de finale",
    },
    {
      id: "slot-1",
      startTime: "10:15",
      durationMinutes: 0,
      type: "BREAK",
      title: "Pause",
    },
  ],
};

describe("ReplaceCompetitionProgramDto (#442)", () => {
  it("accepts what the editor sends", async () => {
    await expect(messagesOf(editorPayload)).resolves.toEqual([]);
  });

  it("requires both lists", async () => {
    const messages = await messagesOf({});
    expect(messages).toEqual(
      expect.arrayContaining([
        "events must be an array",
        "schedule must be an array",
      ]),
    );
  });

  it("validates each event (nested)", async () => {
    const messages = await messagesOf({
      ...editorPayload,
      events: [
        {
          eventKind: "GALA",
          eventType: "TRIO",
          category: "",
          ageGroups: "Adulte",
          extra: true,
        },
      ],
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("events.0.eventKind must be one of"),
        expect.stringContaining("events.0.eventType must be one of"),
        "events.0.category should not be empty",
        "events.0.ageGroups must be an array",
        "events.0.property extra should not exist",
      ]),
    );
  });

  it("validates each schedule slot (nested)", async () => {
    const messages = await messagesOf({
      events: [],
      schedule: [
        {
          startTime: "25:00",
          durationMinutes: 1.5,
          type: "LUNCH",
          title: "   ",
        },
        { startTime: "9:00", durationMinutes: 721, type: "ROUND", title: "x" },
      ],
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        "schedule.0.startTime doit être au format HH:MM",
        "schedule.0.durationMinutes must be an integer number",
        expect.stringContaining("schedule.0.type must be one of"),
        "schedule.0.title ne doit pas être vide",
        "schedule.1.startTime doit être au format HH:MM",
        "schedule.1.un créneau dure au plus 720 minutes",
      ]),
    );
  });

  it("bounds the lists", async () => {
    const event = editorPayload.events[0];
    const messages = await messagesOf({
      events: Array.from({ length: 401 }, () => event),
      schedule: [],
    });
    expect(messages).toContain("events must contain no more than 400 elements");
  });
});
