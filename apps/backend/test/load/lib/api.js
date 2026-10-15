/**
 * HTTP helpers of the k6 load tests: login / refresh, tagged GET/POST, the
 * scale-to-zero wake-up wait, and the shared custom metrics.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import {
  API,
  BASE_URL,
  PASSWORD,
  baseHeaders,
  fakeIpForSetup,
  SPOOF_IPS,
} from "./config.js";

/** Share of responses refused by a rate limiter (429). */
export const rateLimited = new Rate("rate_limited");
/** 5xx count: always a defect under load (timeouts, pool exhaustion…). */
export const serverErrors = new Counter("server_errors");
/** Time until /health first answered 200 (cold start of a sleeping app). */
export const wakeTime = new Trend("wake_time", true);

function track(res) {
  rateLimited.add(res.status === 429);
  if (res.status >= 500) serverErrors.add(1);
  return res;
}

function params(name, token, extraHeaders) {
  const headers = baseHeaders(extraHeaders);
  if (token) headers.Authorization = `Bearer ${token}`;
  return { headers, tags: { name } };
}

/** GET on the API; `name` groups the URL in the results (ids stripped). */
export function apiGet(path, name, token, extraHeaders) {
  return track(http.get(`${API}${path}`, params(name, token, extraHeaders)));
}

export function apiPost(path, body, name, token, extraHeaders) {
  const p = params(name, token, {
    "Content-Type": "application/json",
    ...(extraHeaders || {}),
  });
  return track(http.post(`${API}${path}`, JSON.stringify(body), p));
}

export function health(extraHeaders) {
  return track(
    http.get(`${BASE_URL}/health`, {
      headers: baseHeaders(extraHeaders),
      tags: { name: "GET /health" },
    }),
  );
}

/**
 * Waits for a sleeping backend (scale-to-zero) the way the app does: polls
 * /health until it answers 200, then records the elapsed time in `wake_time`.
 * Locally it answers at once. Fails the run after `maxSeconds`.
 */
export function waitForBackend(maxSeconds) {
  const started = Date.now();
  const headers = SPOOF_IPS ? { "X-Forwarded-For": fakeIpForSetup(0) } : {};
  for (;;) {
    let res;
    try {
      res = http.get(`${BASE_URL}/health`, {
        headers: baseHeaders(headers),
        timeout: "30s",
        tags: { name: "GET /health (wake)" },
      });
    } catch {
      res = null;
    }
    if (res && res.status === 200) {
      const elapsed = Date.now() - started;
      wakeTime.add(elapsed);
      let version = "?";
      try {
        version = res.json("version") || "?";
      } catch {
        version = "?";
      }
      console.log(
        `Backend prêt en ${Math.round(elapsed / 1000)} s (version ${version})`,
      );
      return version;
    }
    if (Date.now() - started > maxSeconds * 1000) {
      throw new Error(
        `Backend injoignable après ${maxSeconds} s (dernier statut : ${res ? res.status : "aucune réponse"})`,
      );
    }
    sleep(5);
  }
}

/**
 * POST /auth/login. Returns `{ access, refresh, userId }` or null. Login is
 * limited to 5/min per client IP: pass a distinct X-Forwarded-For per account
 * in setup() when SPOOF_IPS is on.
 */
export function login(email, extraHeaders) {
  const res = apiPost(
    "/auth/login",
    { username: email, password: PASSWORD },
    "POST /auth/login",
    null,
    extraHeaders,
  );
  const ok = check(res, { "login 200/201": (r) => r.status < 300 });
  if (!ok) {
    console.warn(`login refusé pour ${email} : HTTP ${res.status}`);
    return null;
  }
  return {
    access: res.json("access_token"),
    refresh: res.json("refresh_token"),
    userId: res.json("user.id"),
  };
}

/** POST /auth/refresh with rotation: returns the new pair, or null. */
export function refresh(session) {
  const res = apiPost(
    "/auth/refresh",
    { refresh_token: session.refresh },
    "POST /auth/refresh",
  );
  const ok = check(res, { "refresh 200/201": (r) => r.status < 300 });
  if (!ok) return null;
  return {
    access: res.json("access_token"),
    refresh: res.json("refresh_token"),
    userId: session.userId,
  };
}

/** Spacing of setup() logins sharing one real IP: 5 logins/min per IP. */
const SHARED_IP_LOGIN_SPACING_S = 13;

/**
 * Logs in a list of accounts from setup(): one fake IP per account when
 * SPOOF_IPS is on; otherwise (staging, SHARED_IP) every login comes from the
 * runner's own IP, so they are spaced to stay under 5 logins/min.
 */
export function loginAll(emails, slotOffset) {
  const sessions = [];
  emails.forEach((email, i) => {
    if (!SPOOF_IPS && i > 0) sleep(SHARED_IP_LOGIN_SPACING_S);
    const headers = SPOOF_IPS
      ? { "X-Forwarded-For": fakeIpForSetup((slotOffset || 0) + i + 1) }
      : {};
    const session = login(email, headers);
    if (session) sessions.push({ email, ...session });
  });
  return sessions;
}

/** Default thresholds shared by every scenario (overridable per script). */
export const COMMON_THRESHOLDS = {
  // Errors: anything but 2xx/3xx, 429 included (see rate_limited).
  http_req_failed: ["rate<0.01"],
  rate_limited: ["rate<0.01"],
  server_errors: ["count<1"],
  checks: ["rate>0.99"],
};
