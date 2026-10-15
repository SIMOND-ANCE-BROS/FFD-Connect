/**
 * Scenario « check-in jour de compétition » (issue #488): short burst.
 *
 * - `dancers`: dancers arriving at the venue all open the app at once: their
 *   licence card (GET /licenses/my, the QR they show) and the competition
 *   (GET /competitions/:id, GET /competitions/user/registrations). Spike:
 *   ramp to PEAK_RATE arrivals/s in 30 s, hold, ramp down.
 * - `scanners`: SCANNER_COUNT staff phones scanning those QR codes
 *   (POST /competitions/:id/checkin) at SCANS_PER_MIN each. The route is
 *   limited to 30 check-ins/min PER STAFF ACCOUNT (ThrottlerUserGuard):
 *   SCANS_PER_MIN must stay under it — more throughput = more scanner
 *   accounts, exactly as on site.
 *
 * Data: seed-load-test.ts (competition `load-comp`, licensees registered,
 * confirmed and paid, check-ins reset at every seed). The QR codes are read
 * from the licensees' own GET /licenses/my in setup() (signed QR when the
 * server signs them, else the licence number).
 *
 *   k6 run -e LOAD_PASSWORD=… apps/backend/test/load/checkin-burst.js
 *
 * Knobs: SCALE, PEAK_RATE (default 20 dancers/s), HOLD (default 2m),
 * SCANS_PER_MIN (default 20), QR_SOURCES (licensees logged in for their QR,
 * default all seeded licensees locally, 10 without fake IPs).
 */
import exec from "k6/execution";
import { check } from "k6";
import {
  COMMON_THRESHOLDS,
  apiGet,
  apiPost,
  loginAll,
  waitForBackend,
} from "./lib/api.js";
import {
  COMPETITION_ID,
  LICENSEE_COUNT,
  SCANNER_COUNT,
  SPOOF_IPS,
  defaultSessions,
  fakeIpForAccount,
  licenseeEmail,
  requirePassword,
  scaled,
  scannerEmail,
} from "./lib/config.js";

/** Per-user limit of POST /competitions/:id/checkin (competitions.controller.ts). */
const CHECKIN_LIMIT_PER_MIN = 30;

const PEAK_RATE = scaled(Number(__ENV.PEAK_RATE || "20"));
const HOLD = __ENV.HOLD || "2m";
const SCANS_PER_MIN = Number(__ENV.SCANS_PER_MIN || "20");
const QR_SOURCES = defaultSessions(LICENSEE_COUNT);

if (!(SCANS_PER_MIN > 0) || SCANS_PER_MIN >= CHECKIN_LIMIT_PER_MIN) {
  throw new Error(
    `SCANS_PER_MIN doit être entre 0 et ${CHECKIN_LIMIT_PER_MIN} (exclus) : la limite est par compte staff. Pour plus de débit, augmenter LOAD_SCANNER_COUNT.`,
  );
}

const BURST_DURATION_S = 30 + parseDurationS(HOLD) + 30;

function parseDurationS(value) {
  const match = /^(\d+)(s|m)$/.exec(value);
  if (!match) throw new Error(`HOLD au format 90s ou 2m (reçu "${value}")`);
  return Number(match[1]) * (match[2] === "m" ? 60 : 1);
}

export const options = {
  setupTimeout: "15m",
  scenarios: {
    dancers: {
      executor: "ramping-arrival-rate",
      exec: "dancer",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: Math.max(10, PEAK_RATE * 4),
      maxVUs: Math.max(20, PEAK_RATE * 10),
      stages: [
        { target: PEAK_RATE, duration: "30s" },
        { target: PEAK_RATE, duration: HOLD },
        { target: 0, duration: "30s" },
      ],
    },
    // Total scan rate spread round-robin over the scanner accounts: each
    // account scans exactly SCANS_PER_MIN times a minute, whatever VU runs
    // the iteration (mapping VU ids to accounts collides across scenarios).
    scanners: {
      executor: "constant-arrival-rate",
      exec: "scanner",
      rate: SCANNER_COUNT * SCANS_PER_MIN,
      timeUnit: "1m",
      duration: `${BURST_DURATION_S}s`,
      preAllocatedVUs: SCANNER_COUNT,
      maxVUs: SCANNER_COUNT * 3,
    },
  },
  thresholds: {
    ...COMMON_THRESHOLDS,
    // The number the issue asks for: check-in under load.
    "http_req_duration{name:POST /competitions/:id/checkin}": [
      "p(95)<800",
      "p(99)<2000",
    ],
    "http_req_duration{name:GET /licenses/my}": ["p(95)<400", "p(99)<1000"],
    "http_req_duration{name:GET /competitions/:id}": ["p(95)<500"],
    "http_req_duration{name:GET /competitions/user/registrations}": [
      "p(95)<500",
    ],
    "checks{check:checkin accepted}": ["rate>0.99"],
  },
};

export function setup() {
  requirePassword();
  if (SCANNER_COUNT === 0) throw new Error("LOAD_SCANNER_COUNT doit être ≥ 1");
  waitForBackend(Number(__ENV.WAKE_TIMEOUT || "180"));

  const licenseeEmails = [];
  for (let i = 0; i < QR_SOURCES; i++) licenseeEmails.push(licenseeEmail(i));
  const dancers = loginAll(licenseeEmails, 0);

  const qrCodes = [];
  dancers.forEach((s) => {
    const res = apiGet("/licenses/my", "GET /licenses/my (setup)", s.access);
    if (res.status !== 200) return;
    const qr = res.json("qrCode") || res.json("number");
    if (qr) qrCodes.push(qr);
  });

  const scannerEmails = [];
  for (let i = 0; i < SCANNER_COUNT; i++) scannerEmails.push(scannerEmail(i));
  const scanners = loginAll(scannerEmails, 1000);

  if (
    dancers.length === 0 ||
    qrCodes.length === 0 ||
    scanners.length < SCANNER_COUNT
  ) {
    throw new Error(
      `Données de charge incomplètes (licenciés connectés ${dancers.length}, QR ${qrCodes.length}, scanners ${scanners.length}) : lancer seed-load-test.ts`,
    );
  }
  console.log(
    `${dancers.length} licenciés, ${qrCodes.length} QR, ${scanners.length} scanners prêts`,
  );
  return {
    dancerTokens: dancers.map((s) => s.access),
    scannerTokens: scanners.map((s) => s.access),
    qrCodes,
  };
}

export function dancer(data) {
  // Arrival-rate iterations are short and k6 reuses the same few VUs: the
  // fake IP follows the dancer (account), not the VU, or one VU would carry
  // the whole venue's traffic on a single 100 req/min budget.
  const n = exec.scenario.iterationInTest % data.dancerTokens.length;
  const token = data.dancerTokens[n];
  const phone = SPOOF_IPS ? { "X-Forwarded-For": fakeIpForAccount(n) } : {};
  check(apiGet("/licenses/my", "GET /licenses/my", token, phone), {
    "licence 200": (r) => r.status === 200,
  });
  check(
    apiGet(
      `/competitions/${COMPETITION_ID}`,
      "GET /competitions/:id",
      token,
      phone,
    ),
    { "competition 200": (r) => r.status === 200 },
  );
  check(
    apiGet(
      "/competitions/user/registrations",
      "GET /competitions/user/registrations",
      token,
      phone,
    ),
    { "registrations 200": (r) => r.status === 200 },
  );
}

export function scanner(data) {
  const n = exec.scenario.iterationInTest;
  const token = data.scannerTokens[n % data.scannerTokens.length];
  // Walk the QR list in order: every licensee gets a first (write) check-in,
  // then, once the list wraps, repeated scans answer ALREADY_CHECKED_IN.
  const i = n % data.qrCodes.length;
  const res = apiPost(
    `/competitions/${COMPETITION_ID}/checkin`,
    { qrData: data.qrCodes[i] },
    "POST /competitions/:id/checkin",
    token,
  );
  check(res, { "checkin accepted": (r) => r.status === 201 });
}
