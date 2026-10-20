import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserRole } from "@prisma/client";
import { CircuitBreakerService } from "../../common/circuit-breaker/circuit-breaker.service";
import type { FetchedPage } from "../results-import/topturnier/topturnier-http";
import { TopTurnierPageTooLargeError } from "../results-import/topturnier/topturnier-http";
import type { TopTurnierPageSource } from "../results-import/topturnier/topturnier-export";
import { TopTurnierUrlError } from "../results-import/topturnier/topturnier-url";
import {
  CompetitionTopTurnierUrlImportService,
  TOPTURNIER_URL_IMPORT_DEADLINE_MS,
  TOPTURNIER_URL_MAX_PAGES,
  TOPTURNIER_URL_SPACING_MS,
} from "./competition-topturnier-url-import.service";
import type { CompetitionTopTurnierImportService } from "./competition-topturnier-import.service";

const STAFF = { userId: "staff-1", role: "STAFF", roles: [UserRole.STAFF] };
const HOST = "results.example.org";
const URL_OK = `https://${HOST}/2026/exempleville/index.htm?session=x#top`;

const ok = (body: string): FetchedPage => ({
  status: 200,
  location: null,
  body: Buffer.from(body),
});
const redirect = (location: string, status = 302): FetchedPage => ({
  status,
  location,
  body: Buffer.alloc(0),
});

describe("CompetitionTopTurnierUrlImportService (#787, temporary)", () => {
  let env: Record<string, string | undefined>;
  let importFromSource: jest.Mock;
  let fire: jest.Mock;
  let service: CompetitionTopTurnierUrlImportService;
  let fetchPage: jest.SpyInstance<Promise<FetchedPage>, [URL]>;
  let sleep: jest.SpyInstance<Promise<void>, [number]>;
  /** Pages read by the fake pipeline, in order. */
  let reads: string[];

  beforeEach(() => {
    env = {
      TOPTURNIER_URL_IMPORT_ENABLED: "true",
      TOPTURNIER_ALLOWED_HOSTS: HOST,
    };
    reads = ["index.htm", "1-x/erg.htm"];
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    fire = jest.fn((_key: string, fn: () => Promise<unknown>) => fn());
    const breaker = { fire } as unknown as CircuitBreakerService;
    importFromSource = jest.fn(
      async (_id: string, source: TopTurnierPageSource) => {
        for (const path of reads) await source.read(path);
        return { created: 1, events: [] };
      },
    );
    service = new CompetitionTopTurnierUrlImportService(config, breaker, {
      importFromSource,
    } as unknown as CompetitionTopTurnierImportService);
    fetchPage = jest
      .spyOn(service, "fetchPage")
      .mockImplementation(() => Promise.resolve(ok("<html></html>")));
    sleep = jest.spyOn(service, "sleep").mockResolvedValue(undefined);
  });

  it("is disabled unless the flag is « true » (404)", async () => {
    for (const value of [undefined, "", "false", "1", "TRUE"]) {
      env.TOPTURNIER_URL_IMPORT_ENABLED = value;
      await expect(
        service.importUrl("comp-1", URL_OK, STAFF),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("fetches the export under its folder and audits host + path only", async () => {
    await service.importUrl("comp-1", URL_OK, STAFF, { dryRun: true });
    expect(fetchPage.mock.calls.map(([url]) => url.href)).toEqual([
      `https://${HOST}/2026/exempleville/index.htm`,
      `https://${HOST}/2026/exempleville/1-x/erg.htm`,
    ]);
    expect(importFromSource).toHaveBeenCalledWith(
      "comp-1",
      expect.anything(),
      { kind: "TOPTURNIER_URL", url: `${HOST}/2026/exempleville/` },
      STAFF,
      { dryRun: true },
    );
    // Through the breaker, one request at a time, spaced.
    expect(fire).toHaveBeenCalledTimes(0); // fetchPage is mocked here
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(
      TOPTURNIER_URL_SPACING_MS,
    );
  });

  it("uses the default allowlist when the variable is unset", async () => {
    delete env.TOPTURNIER_ALLOWED_HOSTS;
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.importUrl(
      "comp-1",
      "https://chairperson.ddsbagnols.com/x/index.htm",
      STAFF,
    );
    expect(fetchPage).toHaveBeenCalled();
  });

  it.each([
    "https://evil.example.com/x/index.htm",
    "http://127.0.0.1/x/",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
    `https://${HOST}:8443/x/`,
    `https://user:pw@${HOST}/x/`,
    `http://${HOST}/2026/exempleville/index.htm`,
  ])("refuses %s before any request (400)", async (url) => {
    await expect(
      service.importUrl("comp-1", url, STAFF),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(importFromSource).not.toHaveBeenCalled();
  });

  it("follows at most 2 redirects, inside the allowlist only", async () => {
    fetchPage
      .mockResolvedValueOnce(redirect(`https://${HOST}/moved/index.htm`, 301))
      .mockResolvedValueOnce(redirect("/final/index.htm"))
      .mockResolvedValueOnce(ok("<html></html>"));
    reads = ["index.htm"];
    await service.importUrl("comp-1", URL_OK, STAFF);
    expect(fetchPage.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/2026/exempleville/index.htm",
      "/moved/index.htm",
      "/final/index.htm",
    ]);

    fetchPage.mockReset();
    fetchPage
      .mockResolvedValueOnce(redirect(`https://${HOST}/a`))
      .mockResolvedValueOnce(redirect(`https://${HOST}/b`))
      .mockResolvedValueOnce(redirect(`https://${HOST}/c`));
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toMatchObject({
      response: { message: "Trop de redirections" },
    });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it.each([
    "https://evil.example.com/x/",
    "http://127.0.0.1/",
    "http://[::1]/",
    `https://${HOST}:8080/`,
    "file:///etc/passwd",
    `http://${HOST}/2026/exempleville/index.htm`,
  ])("refuses a redirect to %s (400)", async (location) => {
    fetchPage.mockResolvedValueOnce(redirect(location));
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("refuses a page path escaping the export folder", async () => {
    reads = ["../../admin/index.htm"];
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("does not request the .html fallbacks and reads a 404 as a missing page", async () => {
    reads = ["index.htm", "1-x/erg.htm", "1-x/erg.html"];
    fetchPage.mockResolvedValueOnce(ok("<html></html>")).mockResolvedValueOnce({
      status: 404,
      location: null,
      body: Buffer.alloc(0),
    });
    await service.importUrl("comp-1", URL_OK, STAFF);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("caps the number of pages", async () => {
    reads = Array.from(
      { length: TOPTURNIER_URL_MAX_PAGES + 1 },
      (_, i) => `${i}-x/erg.htm`,
    );
    importFromSource.mockImplementation(
      async (_id: string, source: TopTurnierPageSource) => {
        for (const path of reads) await source.read(path);
      },
    );
    await expect(service.importUrl("comp-1", URL_OK, STAFF)).rejects.toThrow(
      "Trop de pages",
    );
    expect(fetchPage).toHaveBeenCalledTimes(TOPTURNIER_URL_MAX_PAGES);
  });

  it("degrades gracefully: unreachable site → 502, open breaker → 503", async () => {
    fetchPage.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(BadGatewayException);

    fetchPage.mockResolvedValueOnce({
      status: 500,
      location: null,
      body: Buffer.alloc(0),
    });
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(BadGatewayException);

    fetchPage.mockRejectedValueOnce(new ServiceUnavailableException());
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("maps a private address and an oversized page to 400", async () => {
    fetchPage.mockRejectedValueOnce(new TopTurnierUrlError("privée"));
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(BadRequestException);
    fetchPage.mockRejectedValueOnce(new TopTurnierPageTooLargeError("/x"));
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stops reading past the import deadline, before any write (400)", async () => {
    let clock = 1_000_000;
    jest.spyOn(service, "now").mockImplementation(() => clock);
    fetchPage.mockImplementation(() => {
      clock += TOPTURNIER_URL_IMPORT_DEADLINE_MS / 2 + 1;
      return Promise.resolve(ok("<html></html>"));
    });
    reads = ["index.htm", "1-x/erg.htm", "2-x/erg.htm"];
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toMatchObject({
      response: { message: "Export trop long à lire : téléversez l'export" },
    });
    // The third page is never requested.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("runs one import at a time per site (409), and frees the site after", async () => {
    let release: () => void = () => undefined;
    importFromSource.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ created: 1, events: [] });
        }),
    );
    const first = service.importUrl("comp-1", URL_OK, STAFF);
    await expect(
      service.importUrl("comp-2", URL_OK, STAFF, { dryRun: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.importUrl("comp-2", URL_OK, STAFF),
    ).rejects.toMatchObject({
      response: {
        message: expect.stringContaining(
          "Un import depuis ce site est déjà en cours",
        ),
      },
    });
    release();
    await expect(first).resolves.toEqual({ created: 1, events: [] });
    // Freed on success…
    await expect(
      service.importUrl("comp-2", URL_OK, STAFF),
    ).resolves.toBeDefined();
    // …and on failure.
    fetchPage.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(
      service.importUrl("comp-2", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      service.importUrl("comp-2", URL_OK, STAFF),
    ).resolves.toBeDefined();
  });

  it("spaces the requests to a site across imports", async () => {
    reads = ["index.htm"];
    await service.importUrl("comp-1", URL_OK, STAFF, { dryRun: true });
    expect(sleep).not.toHaveBeenCalled();
    await service.importUrl("comp-1", URL_OK, STAFF);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(
      TOPTURNIER_URL_SPACING_MS,
    );
  });

  it("shares the per-site lock with the list of recent competitions (#801)", async () => {
    let release: () => void = () => undefined;
    const reading = service.withSiteLock(
      HOST,
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("read");
        }),
    );
    // A list read holds the site: an import waits for it…
    await expect(
      service.importUrl("comp-1", URL_OK, STAFF),
    ).rejects.toBeInstanceOf(ConflictException);
    // …and so does another read.
    await expect(
      service.withSiteLock(HOST, () => Promise.resolve("again")),
    ).rejects.toMatchObject({
      response: { message: expect.stringContaining("déjà en cours") },
    });
    // Another site is not held.
    await expect(
      service.withSiteLock("other.example.org", () => Promise.resolve("other")),
    ).resolves.toBe("other");
    release();
    await expect(reading).resolves.toBe("read");
    // Freed after a failure too.
    await expect(
      service.withSiteLock(HOST, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(
      service.withSiteLock(HOST, () => Promise.resolve("free")),
    ).resolves.toBe("free");
  });

  it("an import in progress holds the site for a list read (#801)", async () => {
    let release: () => void = () => undefined;
    importFromSource.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ created: 1, events: [] });
        }),
    );
    const importing = service.importUrl("comp-1", URL_OK, STAFF);
    await expect(
      service.withSiteLock(HOST, () => Promise.resolve("x")),
    ).rejects.toBeInstanceOf(ConflictException);
    release();
    await importing;
  });

  it("fetchSitePage: same redirects and spacing as an export page (#801)", async () => {
    const hosts = [HOST];
    fetchPage
      .mockResolvedValueOnce(redirect(`https://${HOST}/resultats/b.php`))
      .mockResolvedValueOnce(ok("<html>list</html>"));
    const page = await service.fetchSitePage(
      new URL(`https://${HOST}/resultats/index.php?annee=2026`),
      hosts,
    );
    expect(page?.toString()).toBe("<html>list</html>");
    expect(fetchPage.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/resultats/index.php",
      "/resultats/b.php",
    ]);
    expect(sleep).toHaveBeenCalledTimes(1);

    fetchPage.mockResolvedValueOnce(redirect("https://evil.example/x"));
    await expect(
      service.fetchSitePage(new URL(`https://${HOST}/resultats/`), hosts),
    ).rejects.toBeInstanceOf(TopTurnierUrlError);

    fetchPage.mockResolvedValueOnce({
      status: 404,
      location: null,
      body: Buffer.alloc(0),
    });
    await expect(
      service.fetchSitePage(new URL(`https://${HOST}/resultats/`), hosts),
    ).resolves.toBeNull();
  });

  it("sends every real request through the topturnier breaker", async () => {
    fetchPage.mockRestore();
    fire.mockImplementation(() => Promise.resolve(ok("<html></html>")));
    reads = ["index.htm"];
    await service.importUrl("comp-1", URL_OK, STAFF);
    expect(fire).toHaveBeenCalledWith("topturnier", expect.any(Function));
  });
});
