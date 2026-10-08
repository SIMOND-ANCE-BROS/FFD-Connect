import type {
  Breadcrumb,
  ErrorEvent,
  SpanJSON,
  TransactionEvent,
} from "@sentry/nestjs";
import { sentryRedactionOptions } from "./sentry-redaction";

const TOKEN = "q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW";
const URL = `https://api.example.org/api/v1/Licenses/Wallet/Apple/${TOKEN}?x=1`;

describe("sentryRedactionOptions", () => {
  it("scrubs the request URL, transaction name and contexts of error events", () => {
    const event = {
      type: undefined,
      transaction: `GET /api/v1/licenses/wallet/apple/${TOKEN}`,
      request: { url: URL, query_string: "x=1" },
      contexts: { trace: { data: { "http.target": URL } } },
      exception: { values: [{ value: `Cannot GET ${URL}` }] },
    } as unknown as ErrorEvent;
    const out = sentryRedactionOptions.beforeSend?.(event, {});
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it("scrubs transactions and their spans", () => {
    const event = {
      type: "transaction",
      transaction: `GET /licenses/wallet/apple/${TOKEN}`,
      spans: [{ description: URL, data: { "url.full": URL } }],
    } as unknown as TransactionEvent;
    const out = sentryRedactionOptions.beforeSendTransaction?.(event, {});
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it("scrubs standalone spans", () => {
    const span = {
      span_id: "1",
      trace_id: "2",
      start_timestamp: 0,
      description: URL,
      data: { "http.url": URL },
    } as unknown as SpanJSON;
    const out = sentryRedactionOptions.beforeSendSpan?.(span);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it("scrubs breadcrumbs", () => {
    const breadcrumb: Breadcrumb = {
      category: "http",
      message: URL,
      data: { url: URL },
    };
    const out = sentryRedactionOptions.beforeBreadcrumb?.(breadcrumb);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });
});
