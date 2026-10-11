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

  it("drops the incoming request body of events and transactions (#266)", () => {
    const body = {
      reason: "MEDICAL_RESTRICTION",
      comment: "Contre-indication",
      password: "hunter2",
    };
    const event = {
      type: undefined,
      request: { url: "https://api.example.org/x", method: "POST", data: body },
    } as unknown as ErrorEvent;
    const out = sentryRedactionOptions.beforeSend?.(event, {}) as ErrorEvent;
    expect(out.request).toEqual({
      url: "https://api.example.org/x",
      method: "POST",
    });
    const tx = {
      type: "transaction",
      request: { data: JSON.stringify(body) },
    } as unknown as TransactionEvent;
    const outTx = sentryRedactionOptions.beforeSendTransaction?.(
      tx,
      {},
    ) as TransactionEvent;
    expect(JSON.stringify(outTx)).not.toContain("MEDICAL_RESTRICTION");
  });

  it("leaves an event without body untouched", () => {
    const event = { type: undefined, message: "x" } as unknown as ErrorEvent;
    expect(sentryRedactionOptions.beforeSend?.(event, {})).toEqual(event);
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
