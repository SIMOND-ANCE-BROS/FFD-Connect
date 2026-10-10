import { readFileSync } from "fs";
import { join } from "path";
import { USAGE_EVENT_NAMES } from "./usage.constants";

describe("usage constants", () => {
  it("mirrors the client's AnalyticsEventName union exactly", () => {
    const types = readFileSync(
      join(__dirname, "../../../client/src/services/analytics/types.ts"),
      "utf8",
    );
    const union = /export type AnalyticsEventName =([^;]+);/.exec(types);
    expect(union).not.toBeNull();
    const names = [...(union?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect([...names].sort()).toEqual([...USAGE_EVENT_NAMES].sort());
  });
});
