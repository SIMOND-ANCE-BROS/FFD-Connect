import { clearTokens } from "../../api/tokenStore";
import { currentSessionGeneration, isSameSession } from "../sessionGeneration";

describe("sessionGeneration (#892)", () => {
  it("is the same session until the identity changes", async () => {
    const startedIn = currentSessionGeneration();
    expect(isSameSession(startedIn)).toBe(true);

    await clearTokens();

    expect(isSameSession(startedIn)).toBe(false);
    expect(isSameSession(currentSessionGeneration())).toBe(true);
  });

  it("an unknown start (no mutation context) counts as another session", () => {
    expect(isSameSession(undefined)).toBe(false);
  });
});
