import {
  isTestLicenseNumber,
  isTestUser,
  selectTestClubs,
  selectTestUsers,
} from "./purge-test-accounts.utils";

const user = (id: string, email: string, isStoreReview = false) => ({
  id,
  email,
  isStoreReview,
});

describe("isTestUser", () => {
  it.each([
    ["u1", "beta@test.com"],
    ["u2", "club@test.com"],
    ["u3", "Partner-Demo@TEST.com"],
    ["u4", " staff@test.com "],
    ["seed-scan-user-1", "scan1@whatever.fr"],
  ])("matches seeded account %s <%s>", (id, email) => {
    expect(isTestUser(user(id, email))).toBe(true);
  });

  it.each([
    ["u1", "jane.doe@gmail.com"],
    ["u2", "someone@test.com.fr"],
    ["u3", "someone@mytest.com"],
    ["u4", "test.e2e@ffd.com"],
    ["seedling", "x@example.org"],
  ])("never matches a regular account %s <%s>", (id, email) => {
    expect(isTestUser(user(id, email))).toBe(false);
  });

  it("always keeps the store-review account", () => {
    expect(isTestUser(user("u1", "licensee@test.com", true))).toBe(false);
    // Not flagged yet (first boot after the migration): kept by email.
    expect(isTestUser(user("u1", " Licensee@Test.com", false))).toBe(false);
    expect(isTestUser(user("seed-x", "x@test.com", true))).toBe(false);
  });
});

describe("selectTestUsers", () => {
  it("keeps the order and filters out real and store-review accounts", () => {
    const rows = [
      user("a", "admin@test.com"),
      user("b", "real@example.org"),
      user("c", "licensee@test.com", true),
      user("seed-scan-user-2", "scan2@test.com"),
    ];
    expect(selectTestUsers(rows).map((u) => u.id)).toEqual([
      "a",
      "seed-scan-user-2",
    ]);
  });
});

describe("selectTestClubs", () => {
  const club = (
    id: string,
    name: string,
    memberIds: string[],
    isStoreReview = false,
  ) => ({ id, name, memberIds, isStoreReview });

  it("selects a seeded club whose members are all purged", () => {
    const clubs = [club("c1", "Club Démo Bêta", ["p1", "p2"])];
    expect(selectTestClubs(clubs, new Set(["p1", "p2"]))).toEqual(clubs);
  });

  it("matches seeded names ignoring case and spaces, also when empty", () => {
    const clubs = [club("c1", "  club démo bêta ", [])];
    expect(selectTestClubs(clubs, new Set())).toHaveLength(1);
  });

  it("keeps a seeded club a surviving account is attached to", () => {
    const clubs = [club("c1", "Club Démo Bêta", ["p1", "real"])];
    expect(selectTestClubs(clubs, new Set(["p1"]))).toEqual([]);
  });

  it("keeps the store-review club, flagged or not yet", () => {
    const clubs = [
      club("c1", "Club Test FFD", [], true),
      club("c2", "Club Test FFD", []),
      club("c3", "Club Démo Bêta", [], true),
    ];
    expect(selectTestClubs(clubs, new Set())).toEqual([]);
  });

  it("never selects a club that is not a seeded one", () => {
    const clubs = [club("c1", "Paris Danse Club", [])];
    expect(selectTestClubs(clubs, new Set())).toEqual([]);
  });
});

describe("isTestLicenseNumber", () => {
  it.each(["SCAN-TEST-001", "SCAN-TEST-002", "BETA-EXPIRY-TEST"])(
    "matches seeded license %s",
    (n) => expect(isTestLicenseNumber(n)).toBe(true),
  );

  it.each([
    "TEST-LICENSEE-001",
    "20000101-ber-lu01",
    "SCAN-TEST-",
    "X-SCAN-TEST-1",
  ])("keeps license %s", (n) => expect(isTestLicenseNumber(n)).toBe(false));
});
