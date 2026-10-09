import api from "../../../../services/api";
import { ClubService } from "../ClubService";

jest.mock("../../../../services/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
}));

describe("ClubService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── getMembers ──────────────────────────────────────────────────────────────

  describe("getMembers", () => {
    const mockMember = {
      id: "m1",
      firstName: "Jean",
      lastName: "Dupont",
      email: "",
      role: "LICENSEE",
    };

    it("fetches members without options (no query string)", async () => {
      (api.get as jest.Mock).mockResolvedValue({
        data: {
          data: [mockMember],
          meta: { total: 1, skip: 0, take: 10, hasMore: false },
        },
      });

      const members = await ClubService.getMembers();

      expect(api.get).toHaveBeenCalledWith("/users/members");
      expect(members).toHaveLength(1);
    });

    it("appends take param when provided", async () => {
      (api.get as jest.Mock).mockResolvedValue({
        data: {
          data: [],
          meta: { total: 0, skip: 0, take: 50, hasMore: false },
        },
      });

      await ClubService.getMembers({ take: 50 });

      expect(api.get).toHaveBeenCalledWith("/users/members?take=50");
    });

    it("appends skip param when provided", async () => {
      (api.get as jest.Mock).mockResolvedValue({
        data: {
          data: [],
          meta: { total: 0, skip: 10, take: 10, hasMore: false },
        },
      });

      await ClubService.getMembers({ skip: 10 });

      expect(api.get).toHaveBeenCalledWith("/users/members?skip=10");
    });

    it("appends both take and skip when provided", async () => {
      (api.get as jest.Mock).mockResolvedValue({
        data: {
          data: [],
          meta: { total: 0, skip: 20, take: 5, hasMore: true },
        },
      });

      await ClubService.getMembers({ take: 5, skip: 20 });

      expect(api.get).toHaveBeenCalledWith("/users/members?take=5&skip=20");
    });
  });

  // ─── getMembersForPartnership ────────────────────────────────────────────────

  describe("getMembersForPartnership", () => {
    it("fetches without query string when secondaryClubId is undefined", async () => {
      (api.get as jest.Mock).mockResolvedValue({ data: [] });

      await ClubService.getMembersForPartnership();

      expect(api.get).toHaveBeenCalledWith("/clubs/me/partnerships/members");
    });

    it("appends secondaryClubId when provided", async () => {
      (api.get as jest.Mock).mockResolvedValue({ data: [] });

      await ClubService.getMembersForPartnership("club-99");

      expect(api.get).toHaveBeenCalledWith(
        "/clubs/me/partnerships/members?secondaryClubId=club-99",
      );
    });
  });

  // ─── checkEligibility ───────────────────────────────────────────────────────

  describe("checkEligibility", () => {
    const member = {
      id: "m1",
      firstName: "Jean",
      lastName: "Dupont",
      email: "",
      role: "LICENSEE" as const,
      category: "Latin",
      ageGroup: "Adult",
      competitionLevel: "B",
    };

    it("returns true when no filter is applied", () => {
      expect(ClubService.checkEligibility(member, {})).toBe(true);
    });

    it("returns true when category and ageGroup match", () => {
      expect(
        ClubService.checkEligibility(member, {
          category: "Latin",
          ageGroup: "Adult",
        }),
      ).toBe(true);
    });

    it("returns false when category does not match", () => {
      expect(
        ClubService.checkEligibility(member, { category: "Standard" }),
      ).toBe(false);
    });

    it("returns false when ageGroup does not match", () => {
      expect(ClubService.checkEligibility(member, { ageGroup: "Junior" })).toBe(
        false,
      );
    });

    it("matches canonical and legacy age-class spellings", () => {
      // Legacy member class « Adult » vs canonical deduced event « Adulte ».
      expect(ClubService.checkEligibility(member, { ageGroup: "Adulte" })).toBe(
        true,
      );
      const senior = { ...member, ageGroup: "Senior II" };
      expect(ClubService.checkEligibility(senior, { ageGroup: "Senior" })).toBe(
        true,
      );
      expect(
        ClubService.checkEligibility(senior, { ageGroup: "Senior III" }),
      ).toBe(false);
      // « Espoir » (under 21) is open to Youth and Adulte couples.
      expect(ClubService.checkEligibility(member, { ageGroup: "Espoir" })).toBe(
        true,
      );
      expect(ClubService.checkEligibility(senior, { ageGroup: "Espoir" })).toBe(
        false,
      );
    });

    it("ignores category filter when filter.category is empty string", () => {
      expect(ClubService.checkEligibility(member, { category: "" })).toBe(true);
    });

    it("ignores ageGroup filter when filter.ageGroup is empty string", () => {
      expect(ClubService.checkEligibility(member, { ageGroup: "" })).toBe(true);
    });

    it("returns false when eventKind is CLASSIFICATRICE and level does not match", () => {
      expect(
        ClubService.checkEligibility(member, {
          eventKind: "CLASSIFICATRICE",
          level: "A",
        }),
      ).toBe(false);
    });

    it("returns true when eventKind is CLASSIFICATRICE and level matches", () => {
      expect(
        ClubService.checkEligibility(member, {
          eventKind: "CLASSIFICATRICE",
          level: "B",
        }),
      ).toBe(true);
    });

    it("ignores level when eventKind is not CLASSIFICATRICE", () => {
      expect(
        ClubService.checkEligibility(member, {
          eventKind: "LIBRE",
          level: "A",
        }),
      ).toBe(true);
    });

    it("ignores level check when level filter is empty string", () => {
      expect(
        ClubService.checkEligibility(member, {
          eventKind: "CLASSIFICATRICE",
          level: "",
        }),
      ).toBe(true);
    });
  });

  // ─── getPartnerships ─────────────────────────────────────────────────────────

  describe("getPartnerships", () => {
    it("fetches active partnerships by default (activeOnly=true)", async () => {
      (api.get as jest.Mock).mockResolvedValue({
        data: { partnerships: [], myClubId: "c1" },
      });

      await ClubService.getPartnerships();

      expect(api.get).toHaveBeenCalledWith(
        "/clubs/me/partnerships?activeOnly=true",
      );
    });

    it("fetches all partnerships when activeOnly=false", async () => {
      (api.get as jest.Mock).mockResolvedValue({
        data: { partnerships: [], myClubId: "c1" },
      });

      await ClubService.getPartnerships(false);

      expect(api.get).toHaveBeenCalledWith(
        "/clubs/me/partnerships?activeOnly=false",
      );
    });
  });

  // ─── remaining methods ────────────────────────────────────────────────────────

  it("getHelloAssoStatus calls GET /clubs/me/helloasso", async () => {
    const status = {
      clubName: "Danse Club",
      helloAssoConnected: true,
      organizationSlug: "danse",
    };
    (api.get as jest.Mock).mockResolvedValue({ data: status });

    const result = await ClubService.getHelloAssoStatus();

    expect(api.get).toHaveBeenCalledWith("/clubs/me/helloasso");
    expect(result).toEqual(status);
  });

  it("connectHelloAsso calls PUT /clubs/me/helloasso", async () => {
    const response = { clubName: "Club", helloAssoConnected: true as const };
    (api.put as jest.Mock).mockResolvedValue({ data: response });

    const result = await ClubService.connectHelloAsso({
      clientId: "id",
      clientSecret: "secret",
      organizationSlug: "slug",
    });

    expect(api.put).toHaveBeenCalledWith(
      "/clubs/me/helloasso",
      expect.any(Object),
    );
    expect(result).toEqual(response);
  });

  it("setRegistrationMode calls PATCH /clubs/me/registration-mode", async () => {
    const response = {
      clubName: "Club",
      registrationMode: "CLUB_ONLY" as const,
    };
    (api.patch as jest.Mock).mockResolvedValue({ data: response });

    const result = await ClubService.setRegistrationMode("CLUB_ONLY");

    expect(api.patch).toHaveBeenCalledWith("/clubs/me/registration-mode", {
      registrationMode: "CLUB_ONLY",
    });
    expect(result).toEqual(response);
  });

  it("getMyClubRegistrationMode calls GET /clubs/me/registration-mode", async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { registrationMode: "CLUB_AND_MEMBERS_PENDING" },
    });

    const result = await ClubService.getMyClubRegistrationMode();

    expect(api.get).toHaveBeenCalledWith("/clubs/me/registration-mode");
    expect(result.registrationMode).toBe("CLUB_AND_MEMBERS_PENDING");
  });

  it("createPartnership calls POST /clubs/me/partnerships", async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        partnership: { id: "p1" },
        coupleAgeGroup: "Adult",
        suggestedLevel: "B",
        suggestedCategories: [],
      },
    });

    await ClubService.createPartnership({ user1Id: "u1", user2Id: "u2" });

    expect(api.post).toHaveBeenCalledWith(
      "/clubs/me/partnerships",
      expect.any(Object),
    );
  });

  it("endPartnership calls PATCH with endDate", async () => {
    (api.patch as jest.Mock).mockResolvedValue({ data: { id: "p1" } });

    await ClubService.endPartnership("p1", "2025-12-31");

    expect(api.patch).toHaveBeenCalledWith("/clubs/me/partnerships/p1/end", {
      endDate: "2025-12-31",
    });
  });

  it("validatePartnership calls PATCH with accepted flag", async () => {
    (api.patch as jest.Mock).mockResolvedValue({ data: { id: "p1" } });

    await ClubService.validatePartnership("p1", true);

    expect(api.patch).toHaveBeenCalledWith(
      "/clubs/me/partnerships/p1/validate",
      { accepted: true },
    );
  });

  it("getSoloTeams calls GET /clubs/me/solo-teams", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });

    await ClubService.getSoloTeams();

    expect(api.get).toHaveBeenCalledWith("/clubs/me/solo-teams");
  });

  it("addSoloTeamMember calls POST with userId", async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { id: "t1", members: [] },
    });

    await ClubService.addSoloTeamMember("team-1", "user-1");

    expect(api.post).toHaveBeenCalledWith(
      "/clubs/me/solo-teams/team-1/members",
      { userId: "user-1" },
    );
  });

  it("removeSoloTeamMember calls DELETE", async () => {
    (api.delete as jest.Mock).mockResolvedValue({
      data: { id: "t1", members: [] },
    });

    await ClubService.removeSoloTeamMember("team-1", "user-1");

    expect(api.delete).toHaveBeenCalledWith(
      "/clubs/me/solo-teams/team-1/members/user-1",
    );
  });
});
