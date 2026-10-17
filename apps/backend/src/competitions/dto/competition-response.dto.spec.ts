import { Controller, Get, INestApplication } from "@nestjs/common";
import {
  ApiResponse,
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type ReferenceObject,
  type ResponseObject,
  type SchemaObject,
} from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { CompetitionStatus } from "@prisma/client";
import {
  ACTIVE_COMPETITION_SELECT,
  COMPETITION_BASE_SELECT,
  EVENT_BASE_SELECT,
} from "../services/competition-query.service";
import {
  ApiActiveCompetitionResponse,
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

  @Get("active")
  @ApiActiveCompetitionResponse()
  active(): void {}
}

/**
 * Guards #712: the documented response of GET /competitions(/:id) must list
 * exactly what CompetitionQueryService selects, so the generated client
 * types stay true.
 */
describe("competition response DTOs (#712, #729)", () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  let schemas: Record<string, SchemaObject | ReferenceObject>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
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

  describe("GET /competitions/active (#729)", () => {
    it("documents exactly what findActiveCompetition selects", () => {
      expect(keys("CompetitionActiveDto")).toEqual(
        Object.keys(ACTIVE_COMPETITION_SELECT).sort(),
      );
      expect(
        Object.keys(ACTIVE_COMPETITION_SELECT.events.select).sort(),
      ).toEqual(keys("CompetitionEventDto"));
      const events = schema("CompetitionActiveDto").properties?.events as
        | SchemaObject
        | undefined;
      expect(events?.items).toEqual({
        $ref: "#/components/schemas/CompetitionEventDto",
      });
    });

    it("documents a nullable 200 and no 404", () => {
      const responses = document.paths["/probe/active"].get?.responses ?? {};
      expect(Object.keys(responses)).toEqual(["200"]);
      const ok = responses["200"] as ResponseObject;
      expect(ok.content?.["application/json"]?.schema).toEqual({
        nullable: true,
        allOf: [{ $ref: "#/components/schemas/CompetitionActiveDto" }],
      });
    });
  });

  it("wraps the list in data + meta", () => {
    expect(keys("CompetitionPageDto")).toEqual(["data", "meta"]);
    expect(keys("CompetitionPageMetaDto")).toEqual(
      ["hasMore", "skip", "take", "total"].sort(),
    );
  });
});
