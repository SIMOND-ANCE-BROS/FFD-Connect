import { UserRole } from "@prisma/client";
import { accountBlockReason } from "./account-status";

describe("accountBlockReason", () => {
  const at = new Date("2026-10-07T10:00:00Z");

  it("is null for an active account", () => {
    expect(
      accountBlockReason({
        role: UserRole.LICENSEE,
        disabledAt: null,
        club: null,
      }),
    ).toBeNull();
  });

  it("blocks a disabled user, whatever the role", () => {
    expect(
      accountBlockReason({ role: UserRole.ADMIN, disabledAt: at, club: null }),
    ).toBe("USER_DISABLED");
  });

  it("blocks a CLUB account whose club is disabled", () => {
    expect(
      accountBlockReason({
        role: UserRole.CLUB,
        disabledAt: null,
        club: { disabledAt: at },
      }),
    ).toBe("CLUB_DISABLED");
  });

  it("does not block a licensee of a disabled club", () => {
    expect(
      accountBlockReason({
        role: UserRole.LICENSEE,
        disabledAt: null,
        club: { disabledAt: at },
      }),
    ).toBeNull();
  });

  it("reports the user's own deactivation first", () => {
    expect(
      accountBlockReason({
        role: UserRole.CLUB,
        disabledAt: at,
        club: { disabledAt: at },
      }),
    ).toBe("USER_DISABLED");
  });

  it("treats missing fields (legacy fallback select, partial mocks) as active", () => {
    expect(accountBlockReason({})).toBeNull();
  });
});
