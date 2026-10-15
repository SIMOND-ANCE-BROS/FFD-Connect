/**
 * Scenario « connexion / rafraîchissement de jeton » (issue #488).
 *
 * Two parallel scenarios:
 * - `login_storm`: dancers logging in (fresh install, update that signed them
 *   out). Login hashes the password with bcrypt (cost 12): the most
 *   CPU-expensive public request of the API, so the first to saturate a
 *   replica. Each iteration poses as a NEW phone (fake IP per iteration) to
 *   stay under the 5 logins/min per IP limit.
 * - `refresh`: apps resuming with an expired access token (60 min): one
 *   login per VU, then POST /auth/refresh with rotation (the new refresh token
 *   replaces the old one), then GET /users/me with the new access token.
 *
 *   k6 run -e LOAD_PASSWORD=… apps/backend/test/load/auth.js
 *
 * Knobs: SCALE, LOGIN_RATE (logins/s, default 2), REFRESH_VUS (default 30),
 * DURATION (default 3m).
 */
import exec from "k6/execution";
import { check, sleep } from "k6";
import {
  COMMON_THRESHOLDS,
  apiGet,
  login,
  refresh,
  waitForBackend,
} from "./lib/api.js";
import {
  SPOOF_IPS,
  fakeIpForVu,
  licenseeEmail,
  requirePassword,
  scaled,
} from "./lib/config.js";

const LOGIN_RATE = scaled(Number(__ENV.LOGIN_RATE || "2"));
const REFRESH_VUS = scaled(Number(__ENV.REFRESH_VUS || "30"));
const DURATION = __ENV.DURATION || "3m";

export const options = {
  setupTimeout: "5m",
  scenarios: {
    login_storm: {
      executor: "constant-arrival-rate",
      exec: "loginStorm",
      rate: LOGIN_RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: Math.max(5, LOGIN_RATE * 5),
      maxVUs: Math.max(20, LOGIN_RATE * 20),
    },
    refresh: {
      executor: "constant-vus",
      exec: "refreshLoop",
      vus: REFRESH_VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    ...COMMON_THRESHOLDS,
    "http_req_duration{name:POST /auth/login}": ["p(95)<1500", "p(99)<3000"],
    "http_req_duration{name:POST /auth/refresh}": ["p(95)<400", "p(99)<1000"],
    "http_req_duration{name:GET /users/me}": ["p(95)<400"],
  },
};

export function setup() {
  requirePassword();
  waitForBackend(Number(__ENV.WAKE_TIMEOUT || "180"));
}

/** Fake IP unique to this iteration (a new phone each time). */
function iterationIp() {
  const n = exec.scenario.iterationInTest + 1;
  return `10.200.${(n >> 8) & 255}.${n & 255}`;
}

export function loginStorm() {
  const n = exec.scenario.iterationInTest;
  const headers = SPOOF_IPS ? { "X-Forwarded-For": iterationIp() } : {};
  const session = login(licenseeEmail(n), headers);
  if (session) {
    check(apiGet("/users/me", "GET /users/me", session.access, headers), {
      "me 200": (r) => r.status === 200,
    });
  }
}

/** Per-VU session (module scope = one copy per VU). */
let session = null;

export function refreshLoop() {
  if (!session) {
    const headers = SPOOF_IPS
      ? { "X-Forwarded-For": fakeIpForVu(exec.vu.idInTest) }
      : {};
    session = login(licenseeEmail(exec.vu.idInTest), headers);
    if (!session) {
      sleep(15); // stay under 5 logins/min for this IP
      return;
    }
  }
  const next = refresh(session);
  if (!next) {
    session = null; // rotation broken: log in again next iteration
    sleep(15);
    return;
  }
  session = next;
  check(apiGet("/users/me", "GET /users/me", session.access), {
    "me 200": (r) => r.status === 200,
  });
  sleep(3 + Math.random() * 4);
}
