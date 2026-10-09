import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { PrismaService } from "../../prisma/prisma.service";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionEventNotificationService } from "./competition-event-notification.service";
import {
  CompetitionEventsDeductionService,
  FfdDocumentTooLargeError,
  MAX_FFD_DOCUMENT_BYTES,
} from "./competition-events-deduction.service";
import { CompetitionSyncService } from "./competition-sync.service";

/**
 * Real axios against a local HTTP server: proves the document size cap is
 * enforced WHILE streaming (the transfer is aborted), not by measuring a
 * fully downloaded buffer.
 */
describe("CompetitionSyncService.downloadFfdDocument (real HTTP)", () => {
  let server: Server;
  let baseUrl: string;
  let bytesSent = 0;
  let handler: (res: ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((_req, res) => handler(res));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    bytesSent = 0;
  });

  const makeService = () =>
    new CompetitionSyncService(
      {} as PrismaService,
      new HttpService(axios.create()),
      { get: () => baseUrl } as unknown as ConfigService,
      {} as CompetitionCacheService,
      {} as CompetitionEventNotificationService,
      {} as CompetitionEventsDeductionService,
    );

  it("aborts an endless chunked transfer once the cap is crossed", async () => {
    const chunk = Buffer.alloc(256 * 1024, 0x41);
    handler = (res) => {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.write("%PDF-");
      const timer = setInterval(() => {
        if (res.destroyed || res.writableEnded) return;
        res.write(chunk);
        bytesSent += chunk.length;
      }, 0);
      res.on("close", () => clearInterval(timer));
    };

    await expect(
      makeService().downloadFfdDocument(`${baseUrl}/endless.pdf`),
    ).rejects.toBeInstanceOf(FfdDocumentTooLargeError);

    // Stopped right after the cap (+ socket buffers), never "all of it".
    expect(bytesSent).toBeLessThan(2 * MAX_FFD_DOCUMENT_BYTES);
  });

  it("aborts a transfer whose Content-Length lies about a huge body", async () => {
    const chunk = Buffer.alloc(256 * 1024, 0x42);
    handler = (res) => {
      res.writeHead(200, {
        "content-type": "application/pdf",
        "content-length": String(MAX_FFD_DOCUMENT_BYTES * 50),
      });
      const timer = setInterval(() => {
        if (res.destroyed || res.writableEnded) return;
        res.write(chunk);
        bytesSent += chunk.length;
      }, 0);
      res.on("close", () => clearInterval(timer));
    };

    await expect(
      makeService().downloadFfdDocument(`${baseUrl}/announced.pdf`),
    ).rejects.toBeInstanceOf(FfdDocumentTooLargeError);
    expect(bytesSent).toBeLessThan(2 * MAX_FFD_DOCUMENT_BYTES);
  });

  it("returns a document under the cap", async () => {
    handler = (res) => {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF-1.7 small");
    };

    const data = await makeService().downloadFfdDocument(`${baseUrl}/ok.pdf`);

    expect(data.toString()).toBe("%PDF-1.7 small");
  });
});
