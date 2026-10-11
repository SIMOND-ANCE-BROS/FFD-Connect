import {
  LEGACY_STORE_REVIEW_EMAIL,
  STORE_REVIEW_CLUB_NAME,
  STORE_REVIEW_EMAIL,
} from "./purge-test-accounts.utils";
import {
  pickStoreReviewUser,
  planClubRename,
  planPasswordUpdate,
  planUserRename,
} from "./seed-profile-test-accounts.utils";

const row = (id: string, email: string, isStoreReview = false) => ({
  id,
  email,
  firstName: "Test",
  lastName: "Licencié",
  isStoreReview,
});

describe("pickStoreReviewUser", () => {
  it("prefers the flagged account, whatever its email", () => {
    const rows = [
      row("a", STORE_REVIEW_EMAIL),
      row("b", "renamed@x.fr", true),
      row("c", LEGACY_STORE_REVIEW_EMAIL),
    ];
    expect(pickStoreReviewUser(rows)?.id).toBe("b");
  });

  it("then the new email, then the legacy email", () => {
    expect(
      pickStoreReviewUser([
        row("c", LEGACY_STORE_REVIEW_EMAIL),
        row("a", ` ${STORE_REVIEW_EMAIL.toUpperCase()}`),
      ])?.id,
    ).toBe("a");
    expect(pickStoreReviewUser([row("c", LEGACY_STORE_REVIEW_EMAIL)])?.id).toBe(
      "c",
    );
  });

  it("returns null when nothing matches", () => {
    expect(pickStoreReviewUser([row("z", "real@gmail.com")])).toBeNull();
    expect(pickStoreReviewUser([])).toBeNull();
  });
});

describe("planUserRename", () => {
  it("renames the legacy account in place", () => {
    expect(planUserRename(row("a", LEGACY_STORE_REVIEW_EMAIL), null)).toEqual({
      ok: true,
      data: {
        email: STORE_REVIEW_EMAIL,
        firstName: "Compte",
        lastName: "Démo",
      },
    });
  });

  it("is a no-op when already renamed", () => {
    const done = {
      ...row("a", STORE_REVIEW_EMAIL),
      firstName: "Compte",
      lastName: "Démo",
    };
    expect(planUserRename(done, { id: "a" })).toEqual({ ok: true, data: {} });
  });

  it("refuses when another user holds the new email", () => {
    const plan = planUserRename(row("a", LEGACY_STORE_REVIEW_EMAIL), {
      id: "other",
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toContain("other");
  });
});

describe("planClubRename", () => {
  it("renames a legacy club", () => {
    expect(planClubRename({ id: "c", name: "Club Test FFD" }, null)).toEqual({
      ok: true,
      data: { name: STORE_REVIEW_CLUB_NAME },
    });
  });

  it("does nothing when already named", () => {
    expect(
      planClubRename({ id: "c", name: STORE_REVIEW_CLUB_NAME }, { id: "c" }),
    ).toEqual({ ok: true, data: {} });
  });

  it("refuses when another club holds the name", () => {
    const plan = planClubRename(
      { id: "c", name: "Club Test FFD" },
      { id: "x" },
    );
    expect(plan.ok).toBe(false);
  });
});

describe("planPasswordUpdate", () => {
  it("rotates when the secret no longer matches", () => {
    expect(planPasswordUpdate("s3cret", false)).toBe("rotate");
  });
  it("keeps when it matches", () => {
    expect(planPasswordUpdate("s3cret", true)).toBe("keep");
  });
  it("keeps when the secret is unset or empty", () => {
    expect(planPasswordUpdate(undefined, false)).toBe("keep");
    expect(planPasswordUpdate("", false)).toBe("keep");
  });
});
