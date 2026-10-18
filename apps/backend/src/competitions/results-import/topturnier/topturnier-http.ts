import { lookup as dnsLookup, type LookupAddress } from "dns";
import { request as httpRequest, type IncomingMessage } from "http";
import { request as httpsRequest } from "https";
import type { LookupFunction } from "net";
import { TopTurnierUrlError, isPublicAddress } from "./topturnier-url";

/**
 * TEMPORARY (#787) — one GET of a page of a public TopTurnier export, until
 * the FFD gives access to its results data (#651).
 *
 * SSRF guard at connection time: the host name is resolved by `guardedLookup`
 * and the socket only ever connects to the addresses it validated (no DNS
 * rebinding between a check and the connection). No proxy (the environment
 * proxy variables are not read by `http.request`), no cookie, no
 * compression, no redirect followed here (the caller re-checks every
 * `Location` against the allowlist), body capped while streaming.
 */

export interface FetchedPage {
  status: number;
  /** `Location` header of a redirect, raw. */
  location: string | null;
  /** Body of a 200 answer, empty otherwise. */
  body: Buffer;
}

export class TopTurnierFetchError extends Error {}

export class TopTurnierPageTooLargeError extends Error {}

/** Identifiable agent: the site owner can tell who reads and why. */
export const TOPTURNIER_USER_AGENT =
  "FFD-Connect-ResultsImport/1.0 (on-demand import of a TopTurnier export by FFD-Connect staff; temporary)";

/** Resolves `hostname`, refusing it when ANY address is not public unicast. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(
    hostname,
    { all: true, family: options.family },
    (error, addresses: LookupAddress[]) => {
      if (error) {
        callback(error, "", 4);
        return;
      }
      if (
        addresses.length === 0 ||
        addresses.some((a) => !isPublicAddress(a.address))
      ) {
        callback(
          new TopTurnierUrlError(
            "Site refusé : son adresse est privée ou réservée",
          ),
          "",
          4,
        );
        return;
      }
      if (options.all === true) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    },
  );
};

export interface FetchPageOptions {
  maxBytes: number;
  /**
   * Total budget of the request, from the call to the last byte: past it the
   * socket is destroyed (a server trickling one byte at a time never trips
   * the inactivity timeout alone). Also the socket inactivity timeout.
   */
  timeoutMs: number;
  /** Tests only: the guarded lookup otherwise. */
  lookup?: LookupFunction;
}

/**
 * One GET, no redirect followed. The scheme is checked by the caller
 * (`checkTopTurnierUrl`: https only, initial URL and every hop); plain http is
 * only reached by the tests' loopback server.
 */
export function fetchTopTurnierPage(
  url: URL,
  options: FetchPageOptions,
): Promise<FetchedPage> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<FetchedPage>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      outcome();
    };
    const fail = (error: Error) => finish(() => reject(error));

    const req = request(
      url,
      {
        method: "GET",
        lookup: options.lookup ?? guardedLookup,
        agent: false,
        headers: {
          "User-Agent": TOPTURNIER_USER_AGENT,
          Accept: "text/html",
          "Accept-Encoding": "identity",
        },
        timeout: options.timeoutMs,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          // Destroyed, not drained: the body of an error or a redirect is
          // never read (a server could stream it forever).
          res.destroy();
          const location = res.headers.location;
          finish(() =>
            resolve({
              status,
              location: typeof location === "string" ? location : null,
              body: Buffer.alloc(0),
            }),
          );
          return;
        }
        const encoding = res.headers["content-encoding"];
        if (encoding !== undefined && encoding !== "identity") {
          res.destroy();
          fail(new TopTurnierFetchError("Page compressée non acceptée"));
          return;
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          res.destroy();
          fail(new TopTurnierPageTooLargeError(url.pathname));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            res.destroy();
            fail(new TopTurnierPageTooLargeError(url.pathname));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          finish(() =>
            resolve({ status, location: null, body: Buffer.concat(chunks) }),
          ),
        );
        res.on("error", fail);
      },
    );
    // Total deadline: `timeout` above only measures socket inactivity, and
    // the caller's `withTimeout` gives up without closing anything.
    const deadline = setTimeout(() => {
      const error = new TopTurnierFetchError("Délai dépassé");
      fail(error);
      req.destroy(error);
    }, options.timeoutMs);
    req.on("timeout", () => {
      const error = new TopTurnierFetchError("Délai dépassé");
      fail(error);
      req.destroy(error);
    });
    req.on("error", fail);
    req.end();
  });
}
