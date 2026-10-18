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
  timeoutMs: number;
  /** Tests only: the guarded lookup otherwise. */
  lookup?: LookupFunction;
}

/** One GET, no redirect followed. */
export function fetchTopTurnierPage(
  url: URL,
  options: FetchPageOptions,
): Promise<FetchedPage> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<FetchedPage>((resolve, reject) => {
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
          res.resume();
          const location = res.headers.location;
          resolve({
            status,
            location: typeof location === "string" ? location : null,
            body: Buffer.alloc(0),
          });
          return;
        }
        const encoding = res.headers["content-encoding"];
        if (encoding !== undefined && encoding !== "identity") {
          res.destroy();
          reject(new TopTurnierFetchError("Page compressée non acceptée"));
          return;
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          res.destroy();
          reject(new TopTurnierPageTooLargeError(url.pathname));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            res.destroy();
            reject(new TopTurnierPageTooLargeError(url.pathname));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ status, location: null, body: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      req.destroy(new TopTurnierFetchError("Délai dépassé"));
    });
    req.on("error", reject);
    req.end();
  });
}
