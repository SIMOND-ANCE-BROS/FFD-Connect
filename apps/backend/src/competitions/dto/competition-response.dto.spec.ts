import { Controller, Get, INestApplication } from "@nestjs/common";
import {
  ApiResponse,
  DocumentBuilder,
  SwaggerModule,
  type ReferenceObject,
  type SchemaObject,
} from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { CompetitionStatus } from "@prisma/client";
import {
  COMPETITION_BASE_SELECT,
  EVENT_BASE_SELECT,
} from "../services/competition-query.service";
import {
  CompetitionDetailDto,
  CompetitionPageDto,
} from "./competition-response.dto";

@Controller("probe")
class ProbeController {
  @Get("list")
  @ApiResponse({ status: 200, type: CompetitionPageDto })
  list(): void {}

  @Get("detail")
  @ApiResponse({ status: 200, type: CompetitionDetailDto })
  detail(): void {}
}

/**
 * Guards #712: the documented response of GET /competitions(/:id) must list
 * exactly what CompetitionQueryService selects, so the generated client
 * types stay true.
 */
describe("competition response DTOs (#712)", () => {
  let app: INestApplication;
  let schemas: Record<string, SchemaObject | ReferenceObject>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    schemas = document.components?.schemas ?? {};
  });

  afterAll(async () => {
    await app.close();
  });

  const schema = (name: string): SchemaObject => {
    const found = schemas[name] as SchemaObject | ReferenceObject | undefined;
    if (!found || "$ref" in found) throw new Error(`No schema ${name}`);
    return found;
  };
  const keys = (name: string): string[] =>
    Object.keys(schema(name).properties ?? {}).sort();

  it("documents every selected competition field, and the detail relations", () => {
    expect(keys("CompetitionDetailDto")).toEqual(
      [...Object.keys(COMPETITION_BASE_SELECT), "events", "schedule"].sort(),
    );
  });

  it("documents the list item with the per-user flags as optional", () => {
    const item = schema("CompetitionListItemDto");
    expect(keys("CompetitionListItemDto")).toEqual(
      [
        ...Object.keys(COMPETITION_BASE_SELECT),
        "events",
        "isRegistered",
        "isEligible",
        "isOrganizedByMyClub",
        "clubMembersRegisteredCount",
      ].sort(),
    );
    expect(item.required).not.toContain("isRegistered");
    expect(item.required).toContain("title");
    expect(item.required).toContain("requireRotatingQr");
  });

  it("documents the selected event fields", () => {
    expect(keys("CompetitionEventDto")).toEqual(
      Object.keys(EVENT_BASE_SELECT).sort(),
    );
    expect(keys("CompetitionListEventDto")).toEqual(
      [...Object.keys(EVENT_BASE_SELECT), "registrations"].sort(),
    );
  });

  it("documents the real competition statuses", () => {
    const status = schema("CompetitionDetailDto").properties?.status as
      | SchemaObject
      | undefined;
    expect(status?.enum).toEqual(Object.values(CompetitionStatus));
  });

  it("wraps the list in data + meta", () => {
    expect(keys("CompetitionPageDto")).toEqual(["data", "meta"]);
    expect(keys("CompetitionPageMetaDto")).toEqual(
      ["hasMore", "skip", "take", "total"].sort(),
    );
  });
});
