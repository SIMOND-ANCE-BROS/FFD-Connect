/**
 * Smoke of the load-test toolchain (issue #488): ONE pass over every request
 * the scenarios use, to check the target, the seeded data and the accounts
 * before a real campaign. A few dozen requests: safe to run anywhere allowed.
 *
 *   k6 run -e LOAD_PASSWORD=… apps/backend/test/load/smoke.js
 */
import { check, fail } from "k6";
import {
  apiGet,
  apiPost,
  health,
  login,
  refresh,
  waitForBackend,
} from "./lib/api.js";
import {
  COMPETITION_ID,
  SPOOF_IPS,
  TARGET,
  fakeIpForSetup,
  licenseeEmail,
  requirePassword,
  scannerEmail,
} from "./lib/config.js";

export const options = {
  vus: 1,
  iterations: 1,
  setupTimeout: "5m",
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
  },
};

export function setup() {
  requirePassword();
  const version = waitForBackend(Number(__ENV.WAKE_TIMEOUT || "180"));
  console.log(`Cible ${TARGET}, fausses IP ${SPOOF_IPS ? "oui" : "non"}`);
  return { version };
}

function ip(slot) {
  return SPOOF_IPS ? { "X-Forwarded-For": fakeIpForSetup(slot) } : {};
}

export default function () {
  check(health(), { "health 200": (r) => r.status === 200 });

  const dancer = login(licenseeEmail(0), ip(1));
  if (!dancer) fail("connexion licencié impossible");
  const t = dancer.access;

  check(apiGet("/users/me", "GET /users/me", t), {
    "me 200": (r) => r.status === 200,
  });
  const licence = apiGet("/licenses/my", "GET /licenses/my", t);
  check(licence, { "licence 200": (r) => r.status === 200 });
  check(apiGet("/notifications", "GET /notifications", t), {
    "notifications 200": (r) => r.status === 200,
  });
  check(apiGet("/competitions?skip=0&take=20", "GET /competitions", t), {
    "competitions 200": (r) => r.status === 200,
  });
  check(apiGet(`/competitions/${COMPETITION_ID}`, "GET /competitions/:id", t), {
    "load competition seeded": (r) => r.status === 200,
  });
  check(
    apiGet(
      "/competitions/user/registrations",
      "GET /competitions/user/registrations",
      t,
    ),
    { "registrations 200": (r) => r.status === 200 },
  );
  const tracks = apiGet("/tracks?skip=0&take=20", "GET /tracks", t);
  check(tracks, { "tracks 200": (r) => r.status === 200 });

  const rotated = refresh(dancer);
  check(rotated, { "refresh rotated": (s) => s !== null });

  const staff = login(scannerEmail(0), ip(2));
  if (!staff) fail("connexion scanner impossible");
  const qr = licence.json("qrCode") || licence.json("number");
  const scan = apiPost(
    `/competitions/${COMPETITION_ID}/checkin`,
    { qrData: qr },
    "POST /competitions/:id/checkin",
    staff.access,
  );
  check(scan, {
    "checkin 201": (r) => r.status === 201,
    "checkin status known": (r) =>
      ["SUCCESS", "ALREADY_CHECKED_IN"].includes(
        r.json("registrations.0.status"),
      ),
  });
}
