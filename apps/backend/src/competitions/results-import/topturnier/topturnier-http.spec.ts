import { createServer, type IncomingHttpHeaders, type Server } from "http";
import type { AddressInfo, LookupFunction } from "net";
import {
  TOPTURNIER_USER_AGENT,
  TopTurnierPageTooLargeError,
  fetchTopTurnierPage,
  guardedLookup,
} from "./topturnier-http";
import { TopTurnierUrlError } from "./topturnier-url";

/** Test-only lookup: lets the tests reach their loopback server. */
const loopbackLookup: LookupFunction = (_hostname, options, callback) => {
  if (options.all === true) {
    callback(null, [{ address: "127.0.0.1", family: 4 }]);
  } else {
    callback(null, "127.0.0.1", 4);
  }
};

describe("fetchTopTurnierPage", () => {
  let server: Server;
  let port: number;
  let lastHeaders: IncomingHttpHeaders = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastHeaders = req.headers;
      switch (req.url) {
        case "/ok/index.htm":
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<title>OK</title>");
          return;
        case "/redirect":
          res.writeHead(302, { Location: "https://elsewhere.example.org/" });
          res.end();
          return;
        case "/big":
          res.writeHead(200);
          res.end("x".repeat(5000));
          return;
        case "/big-chunked":
          res.writeHead(200, { "Transfer-Encoding": "chunked" });
          for (let i = 0; i < 10; i++) res.write("x".repeat(1000));
          res.end();
          return;
        case "/gzip":
          res.writeHead(200, { "Content-Encoding": "gzip" });
          res.end("x");
          return;
        case "/slow":
          // Never answers: the socket timeout must fire.
          return;
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const url = (path: string) => new URL(`http://results.test:${port}${path}`);
  const options = { maxBytes: 4096, timeoutMs: 2000, lookup: loopbackLookup };

  it("refuses a host resolving to a loopback address (default lookup)", async () => {
    await expect(
      fetchTopTurnierPage(new URL(`http://localhost:${port}/ok/index.htm`), {
        maxBytes: 4096,
        timeoutMs: 2000,
      }),
    ).rejects.toBeInstanceOf(TopTurnierUrlError);
  });

  it("reads a page, with an identifiable agent and no compression", async () => {
    const page = await fetchTopTurnierPage(url("/ok/index.htm"), options);
    expect(page).toEqual({
      status: 200,
      location: null,
      body: Buffer.from("<title>OK</title>"),
    });
    expect(lastHeaders["user-agent"]).toBe(TOPTURNIER_USER_AGENT);
    expect(lastHeaders["accept-encoding"]).toBe("identity");
    expect(lastHeaders.cookie).toBeUndefined();
  });

  it("returns a redirect without following it", async () => {
    await expect(
      fetchTopTurnierPage(url("/redirect"), options),
    ).resolves.toEqual({
      status: 302,
      location: "https://elsewhere.example.org/",
      body: Buffer.alloc(0),
    });
  });

  it("returns a missing page as its status", async () => {
    const page = await fetchTopTurnierPage(url("/missing"), options);
    expect(page.status).toBe(404);
  });

  it("caps the body (declared or streamed)", async () => {
    await expect(
      fetchTopTurnierPage(url("/big"), options),
    ).rejects.toBeInstanceOf(TopTurnierPageTooLargeError);
    await expect(
      fetchTopTurnierPage(url("/big-chunked"), options),
    ).rejects.toBeInstanceOf(TopTurnierPageTooLargeError);
  });

  it("refuses a compressed answer", async () => {
    await expect(fetchTopTurnierPage(url("/gzip"), options)).rejects.toThrow(
      "compressée",
    );
  });

  it("times out a silent server", async () => {
    await expect(
      fetchTopTurnierPage(url("/slow"), { ...options, timeoutMs: 200 }),
    ).rejects.toThrow("Délai dépassé");
  });
});

describe("guardedLookup", () => {
  const resolve = (hostname: string, all: boolean) =>
    new Promise<unknown>((done, fail) => {
      guardedLookup(hostname, { all }, (error, address) => {
        if (error) fail(error);
        else done(address);
      });
    });

  it("refuses a name resolving to loopback, in both lookup modes", async () => {
    await expect(resolve("localhost", false)).rejects.toBeInstanceOf(
      TopTurnierUrlError,
    );
    await expect(resolve("localhost", true)).rejects.toBeInstanceOf(
      TopTurnierUrlError,
    );
  });
});
