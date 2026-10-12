import { ArgumentMetadata, BadRequestException } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import {
  CreateCompetitionDto,
  UpdateCompetitionDto,
} from "./competition-management.dto";

/**
 * Contract between the club competition editor (apps/client, #417) and
 * POST/PATCH /competitions, checked with the exact ValidationPipe options of
 * main.ts.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const meta = (metatype: ArgumentMetadata["metatype"]): ArgumentMetadata => ({
  type: "body",
  metatype,
  data: "",
});

const messagesOf = async (
  body: Record<string, unknown>,
  metatype: ArgumentMetadata["metatype"],
): Promise<string[]> => {
  try {
    await pipe.transform(body, meta(metatype));
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const response = error.getResponse() as { message: string[] };
    return response.message;
  }
};

/** Payload the editor sent before #417 for a « Compétition ». */
const legacyEditorPayload = {
  title: "Open de Lyon",
  status: "DRAFT",
  date: "12 octobre 2026",
  location: "Lyon",
  type: "COMPETITION",
  competitionType: "PROXIMITE",
  majorSubType: null,
  events: [
    {
      id: "1",
      type: "Couple",
      category: "Latine",
      ageGroup: "Adulte",
      kind: "CLASSIFICATRICE",
    },
  ],
  schedule: [
    {
      id: "1",
      startTime: "10:00",
      type: "ROUND",
      title: "Latine - Adulte - 1/4 Finale",
      duration: 15,
    },
  ],
  eventsDescription: "",
  ticketingUrl: "",
  layout: [],
};

/** Payload the editor sends since #417 for a « Compétition ». */
const editorPayload = {
  title: "Open de Lyon",
  status: "UPCOMING",
  date: "2026-10-12",
  location: "Lyon",
  type: "COMPETITION",
  competitionType: "PROXIMITE",
  eventsDescription: "",
  layout: [
    {
      id: "t1",
      type: "TABLE",
      label: "Table 1",
      capacity: 8,
      x: 10,
      y: 10,
      width: 15,
      height: 10,
    },
  ],
};

describe("Competition management DTOs — club editor contract (#417)", () => {
  it.each([
    ["POST", CreateCompetitionDto],
    ["PATCH", UpdateCompetitionDto],
  ])(
    "%s rejects the pre-#417 editor payload, events and schedule included",
    async (_verb, metatype) => {
      const messages = await messagesOf(legacyEditorPayload, metatype);
      expect(messages).toEqual(
        expect.arrayContaining([
          "property events should not exist",
          "property schedule should not exist",
        ]),
      );
      // The other mismatches the editor fixed alongside (#417).
      expect(messages.join("\n")).toMatch(/status/);
      expect(messages.join("\n")).toMatch(/date must be a valid ISO 8601/);
      expect(messages.join("\n")).toMatch(/ticketingUrl must be a URL/);
    },
  );

  it("POST accepts the editor payload", async () => {
    expect(await messagesOf(editorPayload, CreateCompetitionDto)).toEqual([]);
  });

  it("PATCH accepts the editor payload with majorSubType: null (clears it)", async () => {
    const body = { ...editorPayload, majorSubType: null };
    expect(await messagesOf(body, UpdateCompetitionDto)).toEqual([]);
    const dto = (await pipe.transform(
      body,
      meta(UpdateCompetitionDto),
    )) as UpdateCompetitionDto;
    expect(dto.majorSubType).toBeNull();
  });

  it("PATCH still validates a non-null majorSubType as a string", async () => {
    const messages = await messagesOf(
      { majorSubType: 42 },
      UpdateCompetitionDto,
    );
    expect(messages).toEqual(["majorSubType must be a string"]);
  });

  it("accepts the editor payload of an « Événement » (no competition fields)", async () => {
    const body = {
      title: "Gala de printemps",
      status: "UPCOMING",
      date: "2026-04-18",
      location: "Lyon",
      type: "EVENT",
      eventsDescription: "Soirée dansante",
      ticketingUrl: "https://www.helloasso.com/associations/x/evenements/gala",
    };
    expect(await messagesOf(body, CreateCompetitionDto)).toEqual([]);
    expect(await messagesOf(body, UpdateCompetitionDto)).toEqual([]);
  });
});
