import type { INestApplication } from "@nestjs/common";
import { GUARDS_METADATA, HEADERS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { STORE_REVIEW_READABLE_KEY } from "../auth/store-review/store-review.decorator";
import { API_GLOBAL_PREFIX } from "../common/api-prefix";
import { DisciplineCatalogQueryService } from "./discipline-catalog.query-service";
import { DisciplinesController } from "./disciplines.controller";
import type { DisciplineCatalogDto } from "./dto/discipline-catalog.dto";

const CATALOG: DisciplineCatalogDto = {
  domains: [
    {
      code: "LATINES_STANDARDS",
      label: "Latines & standards",
      capabilities: ["COUPLE", "PASSPORT"],
      disciplines: [
        { code: "LATIN", label: "Danses latines", aliases: ["latin"] },
      ],
    },
  ],
};

describe("DisciplinesController (#1022)", () => {
  const query = { getCatalog: jest.fn() };
  let app: INestApplication;
  let controller: DisciplinesController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DisciplinesController],
      providers: [{ provide: DisciplineCatalogQueryService, useValue: query }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    await app.init();
    controller = module.get(DisciplinesController);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    query.getCatalog.mockResolvedValue(CATALOG);
  });

  it("serves the catalog from the query service", async () => {
    await expect(controller.getCatalog()).resolves.toBe(CATALOG);
    expect(query.getCatalog).toHaveBeenCalledTimes(1);
  });

  it("is public: no guard on the class or the route", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DisciplinesController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        DisciplinesController.prototype.getCatalog,
      ),
    ).toBeUndefined();
  });

  it("is on the store-review read allowlist (public catalog)", () => {
    expect(
      Reflect.getMetadata(
        STORE_REVIEW_READABLE_KEY,
        DisciplinesController.prototype.getCatalog,
      ),
    ).toEqual({});
  });

  it("declares a one-hour public cache", () => {
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        DisciplinesController.prototype.getCatalog,
      ),
    ).toEqual([{ name: "Cache-Control", value: "public, max-age=3600" }]);
  });

  it("answers GET /api/v1/disciplines without a token, cacheable for an hour", async () => {
    const res = await request(app.getHttpServer())
      .get(`/${API_GLOBAL_PREFIX}/disciplines`)
      .expect(200);
    expect(res.body).toEqual(CATALOG);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
  });
});
