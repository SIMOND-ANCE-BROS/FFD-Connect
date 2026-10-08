import { UserRole } from "@prisma/client";
import {
  hasRole,
  normalizeExtraRoles,
  rolesOf,
  withActiveRole,
  withRole,
} from "./roles";

describe("roles", () => {
  describe("rolesOf", () => {
    it("returns the main role alone when there is no extra role", () => {
      expect(rolesOf({ role: UserRole.LICENSEE })).toEqual([UserRole.LICENSEE]);
      expect(rolesOf({ role: UserRole.LICENSEE, extraRoles: null })).toEqual([
        UserRole.LICENSEE,
      ]);
    });

    it("puts the main role first, then extras in enum order, without duplicates", () => {
      expect(
        rolesOf({
          role: UserRole.ADMIN,
          extraRoles: [UserRole.STAFF, UserRole.LICENSEE, UserRole.ADMIN],
        }),
      ).toEqual([UserRole.ADMIN, UserRole.LICENSEE, UserRole.STAFF]);
    });

    it("drops unknown strings", () => {
      expect(rolesOf({ role: "LICENSEE", extraRoles: ["ROOT"] })).toEqual([
        UserRole.LICENSEE,
      ]);
    });

    it("drops an extra CLUB while the club is disabled, but keeps a main CLUB", () => {
      const disabled = { disabledAt: new Date() };
      expect(
        rolesOf({
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.CLUB],
          club: disabled,
        }),
      ).toEqual([UserRole.LICENSEE]);
      expect(rolesOf({ role: UserRole.CLUB, club: disabled })).toEqual([
        UserRole.CLUB,
      ]);
    });

    it("returns precomputed roles as is (req.user)", () => {
      expect(rolesOf({ roles: [UserRole.LICENSEE, UserRole.ADMIN] })).toEqual([
        UserRole.LICENSEE,
        UserRole.ADMIN,
      ]);
    });
  });

  it("hasRole looks at every role and is false for a missing user", () => {
    const u = { role: UserRole.LICENSEE, extraRoles: [UserRole.ADMIN] };
    expect(hasRole(u, UserRole.ADMIN)).toBe(true);
    expect(hasRole(u, UserRole.CLUB)).toBe(false);
    expect(hasRole(null, UserRole.ADMIN)).toBe(false);
  });

  it("withRole matches the main role or the extra roles", () => {
    expect(withRole(UserRole.CLUB)).toEqual({
      OR: [{ role: UserRole.CLUB }, { extraRoles: { has: UserRole.CLUB } }],
    });
  });

  it("withActiveRole(CLUB) drops an extra CLUB role of a disabled club", () => {
    expect(withActiveRole(UserRole.CLUB)).toEqual({
      OR: [
        { role: UserRole.CLUB },
        { extraRoles: { has: UserRole.CLUB }, club: { disabledAt: null } },
      ],
    });
  });

  it("withActiveRole equals withRole for the other roles", () => {
    expect(withActiveRole(UserRole.LICENSEE)).toEqual(
      withRole(UserRole.LICENSEE),
    );
  });

  it("normalizeExtraRoles removes the main role and duplicates, in enum order", () => {
    expect(
      normalizeExtraRoles(UserRole.CLUB, [
        UserRole.STAFF,
        UserRole.CLUB,
        UserRole.LICENSEE,
        UserRole.STAFF,
      ]),
    ).toEqual([UserRole.LICENSEE, UserRole.STAFF]);
  });
});
