/**
 * Scenario « lancement de l'app » (issue #488).
 *
 * One iteration = one dancer opening the app with a stored session:
 *   /health pre-warm → /users/me → /licenses/my (licence card) →
 *   /notifications → /competitions (list) → /competitions/:id (detail) →
 *   /tracks (library, 2 pages).
 * Think time between screens (≥ 7 s per iteration, so one VU never exceeds
 * ~70 req/min: under the 100 req/min per-IP budget even when k6 reuses it
 * back to back). Arrival rate ramps up, holds, ramps down.
 *
 *   k6 run -e LOAD_PASSWORD=… apps/backend/test/load/app-launch.js
 *
 * Knobs: SCALE (multiplies the rates), PEAK_RATE (launches/s at the plateau,
 * default 10), HOLD (plateau duration, default 5m), RAMP (ramp up / down,
 * default 2m). Runbook:
 * docs/exploitation/tests-de-charge.md.
 */
import { check, sleep } from "k6";
import {
  COMMON_THRESHOLDS,
  apiGet,
  health,
  loginAll,
  waitForBackend,
} from "./lib/api.js";
import {
  COMPETITION_ID,
  defaultSessions,
  licenseeEmail,
  requirePassword,
  scaled,
} from "./lib/config.js";

const PEAK_RATE = scaled(Number(__ENV.PEAK_RATE || "10"));
const HOLD = __ENV.HOLD || "5m";
const RAMP = __ENV.RAMP || "2m";
/** Sessions opened in setup(); VUs reuse them read-only (tokens last 60 min). */
const SESSIONS = defaultSessions(50);

export const options = {
  setupTimeout: "10m",
  scenarios: {
    app_launch: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      // An iteration lasts ~10-20 s (think time): rate × 20 s VUs in flight.
      preAllocatedVUs: Math.max(20, PEAK_RATE * 20),
      maxVUs: Math.max(40, PEAK_RATE * 30),
      stages: [
        { target: PEAK_RATE, duration: RAMP },
        { target: PEAK_RATE, duration: HOLD },
        { target: 0, duration: RAMP },
      ],
    },
  },
  thresholds: {
    ...COMMON_THRESHOLDS,
    "http_req_duration{name:GET /health}": ["p(95)<300"],
    "http_req_duration{name:GET /users/me}": ["p(95)<400", "p(99)<1000"],
    "http_req_duration{name:GET /licenses/my}": ["p(95)<400", "p(99)<1000"],
    "http_req_duration{name:GET /competitions}": ["p(95)<500", "p(99)<1500"],
    "http_req_duration{name:GET /competitions/:id}": [
      "p(95)<500",
      "p(99)<1500",
    ],
    "http_req_duration{name:GET /tracks}": ["p(95)<500", "p(99)<1500"],
    "http_req_duration{name:GET /notifications}": ["p(95)<500"],
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

function think(min, max) {
  sleep(min + Math.random() * (max - min));
}

export default function (data) {
  const token = data.tokens[Math.floor(Math.random() * data.tokens.length)];

  // Silent pre-warm of the app (backendWake.ts).
  check(health(), { "health 200": (r) => r.status === 200 });

  check(apiGet("/users/me", "GET /users/me", token), {
    "me 200": (r) => r.status === 200,
  });
  check(apiGet("/licenses/my", "GET /licenses/my", token), {
    "licence 200": (r) => r.status === 200,
  });
  check(apiGet("/notifications", "GET /notifications", token), {
    "notifications 200": (r) => r.status === 200,
  });
  think(2, 5);

  const list = apiGet(
    "/competitions?skip=0&take=20",
    "GET /competitions",
    token,
  );
  check(list, { "competitions 200": (r) => r.status === 200 });
  let competitionId = COMPETITION_ID;
  try {
    const items = list.json("data");
    if (Array.isArray(items) && items.length > 0) {
      competitionId = items[Math.floor(Math.random() * items.length)].id;
    }
  } catch {
    // keep the seeded competition
  }
  think(2, 5);
  check(
    apiGet(`/competitions/${competitionId}`, "GET /competitions/:id", token),
    { "competition 200": (r) => r.status === 200 },
  );
  think(2, 5);

  check(apiGet("/tracks?skip=0&take=20", "GET /tracks", token), {
    "tracks p1 200": (r) => r.status === 200,
  });
  think(1, 3);
  check(apiGet("/tracks?skip=20&take=20", "GET /tracks", token), {
    "tracks p2 200": (r) => r.status === 200,
  });
}
