import { UserRole } from "@prisma/client";
import {
  impersonationAuthority,
  impersonationTargetRefusal,
} from "./impersonation-policy";

describe("impersonation policy (#733)", () => {
  describe("impersonationAuthority", () => {
    it.each([
      [[UserRole.ADMIN], UserRole.ADMIN],
      [[UserRole.STAFF, UserRole.ADMIN], UserRole.ADMIN],
      [[UserRole.STAFF], UserRole.STAFF],
      [[UserRole.CLUB, UserRole.STAFF], UserRole.STAFF],
      [[UserRole.LICENSEE], null],
      [[UserRole.CLUB], null],
      [[], null],
    ])("roles %j → %s", (roles, expected) => {
      expect(impersonationAuthority({ roles })).toBe(expected);
    });

    it("reads extra roles of an account row", () => {
      expect(
        impersonationAuthority({
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.STAFF],
        }),
      ).toBe(UserRole.STAFF);
    });
  });

  describe("impersonationTargetRefusal", () => {
    const target = (roles: UserRole[]) => ({ roles });

    it.each([UserRole.ADMIN, UserRole.STAFF] as const)(
      "%s never reaches an ADMIN target",
      (authority) => {
        expect(
          impersonationTargetRefusal(
            authority,
            target([UserRole.LICENSEE, UserRole.ADMIN]),
          ),
        ).toBe("TARGET_ADMIN");
      },
    );

    it("STAFF never reaches a STAFF target", () => {
      expect(
        impersonationTargetRefusal(
          UserRole.STAFF,
          target([UserRole.CLUB, UserRole.STAFF]),
        ),
      ).toBe("TARGET_STAFF");
    });

    it("ADMIN may reach a STAFF target", () => {
      expect(
        impersonationTargetRefusal(UserRole.ADMIN, target([UserRole.STAFF])),
      ).toBeNull();
    });

    it.each([UserRole.ADMIN, UserRole.STAFF] as const)(
      "%s may reach a licensee or a club",
      (authority) => {
        expect(
          impersonationTargetRefusal(authority, target([UserRole.LICENSEE])),
        ).toBeNull();
        expect(
          impersonationTargetRefusal(authority, target([UserRole.CLUB])),
        ).toBeNull();
      },
    );
  });
});
