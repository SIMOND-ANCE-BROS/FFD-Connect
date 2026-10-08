import type { NodeOptions } from "@sentry/nestjs";
import { redactSecretsDeep } from "./redact-url";

/**
 * Sentry hooks that strip secrets carried in request URLs (Wallet pass
 * download token, #162) from everything leaving the process: error events
 * (`request.url`, `transaction`, contexts), transactions and their spans
 * (`url.full`, `http.target`, span names), standalone spans and breadcrumbs.
 */
export const sentryRedactionOptions: Pick<
  NodeOptions,
  "beforeSend" | "beforeSendTransaction" | "beforeSendSpan" | "beforeBreadcrumb"
> = {
  beforeSend: (event) => redactSecretsDeep(event),
  beforeSendTransaction: (event) => redactSecretsDeep(event),
  beforeSendSpan: (span) => redactSecretsDeep(span),
  beforeBreadcrumb: (breadcrumb) => redactSecretsDeep(breadcrumb),
};
