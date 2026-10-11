import {
  LEGACY_STORE_REVIEW_CLUB_NAME,
  LEGACY_STORE_REVIEW_EMAIL,
  STORE_REVIEW_CLUB_NAME,
  STORE_REVIEW_EMAIL,
} from "./purge-test-accounts.utils";
import {
  pickStoreReviewClub,
  planClubRename,
  planPasswordUpdate,
  planUserRename,
  resolveStoreReviewAccount,
} from "./seed-profile-test-accounts.utils";

const row = (id: string, email: string, isStoreReview = false) => ({
  id,
  email,
  firstName: "Test",
  lastName: "Licencié",
  isStoreReview,
});

describe("resolveStoreReviewAccount", () => {
  it("updates the flagged account, whatever its email", () => {
    const flagged = row("b", "renamed@x.fr", true);
    const rows = [row("a", STORE_REVIEW_EMAIL), flagged];
    expect(resolveStoreReviewAccount(rows)).toEqual({
      kind: "update",
      user: flagged,
    });
  });

  it("never adopts an unflagged holder of the new or legacy email", () => {
    expect(
      resolveStoreReviewAccount([
        row("a", ` ${STORE_REVIEW_EMAIL.toUpperCase()}`),
        row("c", LEGACY_STORE_REVIEW_EMAIL),
      ]),
    ).toEqual({ kind: "conflict", ids: ["a", "c"] });
  });

  it("creates only when no flagged user and both emails are free", () => {
    expect(resolveStoreReviewAccount([])).toEqual({ kind: "create" });
  });
});

describe("planUserRename", () => {
  it("migrates the legacy account in place", () => {
    expect(planUserRename(row("a", LEGACY_STORE_REVIEW_EMAIL), null)).toEqual({
      ok: true,
      data: {
        email: STORE_REVIEW_EMAIL,
        firstName: "Compte",
        lastName: "Démo",
      },
    });
  });

  it("leaves an already migrated or edited account alone", () => {
    expect(planUserRename(row("a", STORE_REVIEW_EMAIL), null)).toEqual({
      ok: true,
      data: {},
    });
    expect(planUserRename(row("a", "edited@x.fr"), null)).toEqual({
      ok: true,
      data: {},
    });
  });

  it("refuses when another user holds the new email", () => {
    const plan = planUserRename(row("a", LEGACY_STORE_REVIEW_EMAIL), {
      id: "other",
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toContain("other");
  });
});

describe("pickStoreReviewClub", () => {
  const club = (id: string, name: string, isStoreReview = false) => ({
    id,
    name,
    isStoreReview,
  });

  it("prefers the flagged club", () => {
    const rows = [club("a", STORE_REVIEW_CLUB_NAME), club("b", "X", true)];
    expect(pickStoreReviewClub(rows)?.id).toBe("b");
  });

  it("prefers the club already holding the target name over the legacy", () => {
    const rows = [
      club("l", LEGACY_STORE_REVIEW_CLUB_NAME),
      club("n", STORE_REVIEW_CLUB_NAME),
    ];
    expect(pickStoreReviewClub(rows)?.id).toBe("n");
    expect(pickStoreReviewClub([rows[0]])?.id).toBe("l");
    expect(pickStoreReviewClub([])).toBeNull();
  });
});

describe("planClubRename", () => {
  it("renames a legacy club", () => {
    expect(
      planClubRename({ id: "c", name: LEGACY_STORE_REVIEW_CLUB_NAME }, null),
    ).toEqual({ ok: true, data: { name: STORE_REVIEW_CLUB_NAME } });
  });

  it("does nothing when already migrated or edited", () => {
    expect(
      planClubRename({ id: "c", name: STORE_REVIEW_CLUB_NAME }, { id: "c" }),
    ).toEqual({ ok: true, data: {} });
    expect(planClubRename({ id: "c", name: "Edited" }, null)).toEqual({
      ok: true,
      data: {},
    });
  });

  it("reports a conflict when another club holds the name", () => {
    const plan = planClubRename(
      { id: "c", name: LEGACY_STORE_REVIEW_CLUB_NAME },
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
