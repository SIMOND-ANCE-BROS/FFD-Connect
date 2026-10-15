/**
 * Scenario « bibliothèque musicale » (issue #488): browse and play.
 *
 * One iteration = a dancer scrolling the library (GET /tracks, pages of 20),
 * opening a track (GET /tracks/:id) and, with STREAM_AUDIO=true, starting its
 * playback (GET /uploads/<filename>, streamed by the backend from Blob
 * Storage). Streaming is off by default: it moves megabytes per play
 * (bandwidth + egress on staging).
 *
 *   k6 run -e LOAD_PASSWORD=… apps/backend/test/load/library.js
 *
 * Knobs: SCALE, VUS (concurrent listeners at the plateau, default 50), HOLD
 * (default 5m), RAMP (default 1m), PAGES (pages scrolled per iteration, default 3).
 */
import http from "k6/http";
import { check, sleep } from "k6";
import {
  COMMON_THRESHOLDS,
  apiGet,
  loginAll,
  rateLimited,
  waitForBackend,
} from "./lib/api.js";
import {
  BASE_URL,
  defaultSessions,
  baseHeaders,
  licenseeEmail,
  requirePassword,
  scaled,
} from "./lib/config.js";

const VUS = scaled(Number(__ENV.VUS || "50"));
const HOLD = __ENV.HOLD || "5m";
const RAMP = __ENV.RAMP || "1m";
const PAGES = Math.max(1, Number(__ENV.PAGES || "3"));
const PAGE_SIZE = 20;
const STREAM_AUDIO = __ENV.STREAM_AUDIO === "true";
const SESSIONS = defaultSessions(50);

export const options = {
  setupTimeout: "10m",
  scenarios: {
    library: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { target: VUS, duration: RAMP },
        { target: VUS, duration: HOLD },
        { target: 0, duration: "30s" },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    ...COMMON_THRESHOLDS,
    "http_req_duration{name:GET /tracks}": ["p(95)<500", "p(99)<1500"],
    "http_req_duration{name:GET /tracks/:id}": ["p(95)<300", "p(99)<1000"],
    // Time to first byte of the audio: what the dancer waits before playback.
    "http_req_waiting{name:GET /uploads/:file}": ["p(95)<1500"],
  },
};

export function setup() {
  requirePassword();
  waitForBackend(Number(__ENV.WAKE_TIMEOUT || "180"));
  const emails = [];
  for (let i = 0; i < SESSIONS; i++) emails.push(licenseeEmail(i));
  const sessions = loginAll(emails, 0);
  if (sessions.length === 0) {
    throw new Error(
      "Aucune connexion réussie : comptes seedés ? mot de passe ?",
    );
  }
  return { tokens: sessions.map((s) => s.access) };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  let tracks = [];

  for (let page = 0; page < PAGES; page++) {
    const res = apiGet(
      `/tracks?skip=${page * PAGE_SIZE}&take=${PAGE_SIZE}`,
      "GET /tracks",
      token,
    );
    check(res, { "tracks 200": (r) => r.status === 200 });
    try {
      const items = res.json("data");
      if (Array.isArray(items)) tracks = tracks.concat(items);
      if (!res.json("meta.hasMore")) break;
    } catch {
      break;
    }
    sleep(1 + Math.random() * 2); // scrolling
  }

  if (tracks.length === 0) {
    sleep(5);
    return; // empty library: nothing to open (local base without tracks)
  }
  const track = tracks[Math.floor(Math.random() * tracks.length)];
  check(apiGet(`/tracks/${track.id}`, "GET /tracks/:id", token), {
    "track 200": (r) => r.status === 200,
  });

  if (STREAM_AUDIO && track.filename) {
    const res = http.get(
      `${BASE_URL}/uploads/${encodeURIComponent(track.filename)}`,
      {
        headers: baseHeaders(),
        responseType: "none",
        timeout: "60s",
        tags: { name: "GET /uploads/:file" },
      },
    );
    rateLimited.add(res.status === 429);
    check(res, {
      "audio 200/206": (r) => r.status === 200 || r.status === 206,
    });
  }

  // Listening before picking the next track.
  sleep(10 + Math.random() * 20);
}
