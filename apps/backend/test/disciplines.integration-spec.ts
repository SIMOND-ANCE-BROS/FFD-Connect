/**
 * Public catalog of dance domains and disciplines (#1022, ADR-0026) against a
 * real Postgres: the reference rows inserted by the migration itself (replayed
 * by `migrate deploy`), ordering, inactive disciplines and unknown
 * capabilities, through the full HTTP pipeline without a token.
 */
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildHttpApp } from "./integration-app.builder";

const ROUTE = "/api/v1/disciplines";

interface CatalogBody {
  domains: {
    code: string;
    label: string;
    capabilities: string[];
    disciplines: { code: string; label: string; aliases: string[] }[];
  }[];
}

describe("GET /disciplines (integration, real DB, #1022)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now()}`;
  const domainCode = `IT_DOMAIN_${suffix}`;
  const disciplineCodes = [
    `IT_B_${suffix}`,
    `IT_A_${suffix}`,
    `IT_OFF_${suffix}`,
  ];

  beforeAll(async () => {
    const built = await buildHttpApp();
    app = built.app;
    prisma = built.prisma;
  });

  afterAll(async () => {
    await prisma.discipline.deleteMany({
      where: { code: { in: disciplineCodes } },
    });
    await prisma.danceDomain.deleteMany({ where: { code: domainCode } });
    await app.close();
  });

  const get = () => request(app.getHttpServer()).get(ROUTE);

  it("serves the sport dance reference rows of the migration, without a token", async () => {
    const res = await get().expect(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");

    const body = res.body as CatalogBody;
    const sport = body.domains.find((d) => d.code === "LATINES_STANDARDS");
    expect(sport).toEqual({
      code: "LATINES_STANDARDS",
      label: "Latines & standards",
      capabilities: [
        "COUPLE",
        "TEAM",
        "PASSPORT",
        "COMPETITION_LEVELS",
        "TEMPO_PLAYER",
        "COMPETITION_SKATING",
      ],
      disciplines: [
        {
          code: "LATIN",
          label: "Danses latines",
          aliases: ["latin", "latins", "latine", "latines", "danseslatines"],
        },
        {
          code: "STANDARD",
          label: "Danses standards",
          aliases: ["standard", "standards", "dansesstandards"],
        },
        {
          code: "TEN_DANCE",
          label: "10 danses",
          aliases: [
            "tendance",
            "tendances",
            "10dance",
            "10dances",
            "10danse",
            "10danses",
            "dixdanses",
          ],
        },
      ],
    });
  });

  it("orders disciplines by position, hides inactive ones and unknown capabilities", async () => {
    const domain = await prisma.danceDomain.create({
      data: {
        code: domainCode,
        label: "Domaine de test",
        position: 999,
        capabilities: ["COUPLE", "NOT_A_CAPABILITY"],
      },
      select: { id: true },
    });
    await prisma.discipline.createMany({
      data: [
        {
          code: disciplineCodes[0],
          label: "B",
          domainId: domain.id,
          position: 2,
        },
        {
          code: disciplineCodes[1],
          label: "A",
          domainId: domain.id,
          position: 1,
        },
        {
          code: disciplineCodes[2],
          label: "Off",
          domainId: domain.id,
          position: 0,
          active: false,
        },
      ],
    });

    const body = (await get().expect(200)).body as CatalogBody;
    const codes = body.domains.map((d) => d.code);
    // Domains in display order: the reference domain (position 1) first.
    expect(codes.indexOf("LATINES_STANDARDS")).toBeLessThan(
      codes.indexOf(domainCode),
    );
    expect(body.domains.find((d) => d.code === domainCode)).toEqual({
      code: domainCode,
      label: "Domaine de test",
      capabilities: ["COUPLE"],
      disciplines: [
        { code: disciplineCodes[1], label: "A", aliases: [] },
        { code: disciplineCodes[0], label: "B", aliases: [] },
      ],
    });
  });
});
