import type { NodeOptions } from "@sentry/nestjs";
import { redactSecretsDeep } from "./redact-url";

/**
 * Drops the incoming request body Sentry attaches to an event.
 *
 * Sentry 11 collects incoming HTTP request bodies BY DEFAULT
 * (`dataCollection.httpBodies` includes "incomingRequest", whatever
 * `sendDefaultPii` says) and puts them in `event.request.data`. A 5xx on a
 * login would ship the password, one on a renewal refusal the reason and the
 * administrator's comment (health data, #266). No route needs its body in
 * Sentry: it is removed from every event, whatever the route.
 */
function withoutRequestBody<T extends { request?: { data?: unknown } }>(
  event: T,
): T {
  if (event.request?.data === undefined) return event;
  const { data: _data, ...request } = event.request;
  return { ...event, request };
}

/**
 * Sentry hooks that strip secrets carried in request URLs (Wallet pass
 * download token, #162) from everything leaving the process: error events
 * (`request.url`, `transaction`, contexts), transactions and their spans
 * (`url.full`, `http.target`, span names), standalone spans and breadcrumbs.
 * Events and transactions also lose the incoming request body.
 */
export const sentryRedactionOptions: Pick<
  NodeOptions,
  "beforeSend" | "beforeSendTransaction" | "beforeSendSpan" | "beforeBreadcrumb"
> = {
  beforeSend: (event) => redactSecretsDeep(withoutRequestBody(event)),
  beforeSendTransaction: (event) =>
    redactSecretsDeep(withoutRequestBody(event)),
  beforeSendSpan: (span) => redactSecretsDeep(span),
  beforeBreadcrumb: (breadcrumb) => redactSecretsDeep(breadcrumb),
};
