import * as Sentry from "@sentry/react-native";
import { runSessionEndCleanups } from "../../services/sessionCleanup";
import { clearSentryUser, setSentryUser } from "../sentryUser";

describe("sentryUser (#593)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("identifies the user by opaque id and role only", () => {
    setSentryUser("user-uuid", "CLUB");

    expect(Sentry.setUser).toHaveBeenCalledWith({
      id: "user-uuid",
      data: { role: "CLUB" },
    });
  });

  it("stays anonymous when no id is known", () => {
    setSentryUser(undefined, "LICENSEE");

    expect(Sentry.setUser).toHaveBeenCalledWith(null);
  });

  it("clears the user", () => {
    clearSentryUser();

    expect(Sentry.setUser).toHaveBeenCalledWith(null);
  });

  it("clears the user when the session ends", async () => {
    await runSessionEndCleanups();

    expect(Sentry.setUser).toHaveBeenCalledWith(null);
  });
});
