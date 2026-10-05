import { act, renderHook } from "@testing-library/react-native";
import React from "react";
import api from "../../../../services/api";
import {
  CompetitionProvider,
  useCompetitionRepository,
} from "../CompetitionContext";

jest.mock("../../../../services/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

describe("CompetitionContext", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("registers for event", async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CompetitionProvider>{children}</CompetitionProvider>
    );
    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    await act(async () => {
      await result.current.registerForEvent("comp-1", "event-1", "Partner");
    });

    expect(api.post).toHaveBeenCalledWith(
      "/competitions/comp-1/register",
      expect.objectContaining({ eventId: "event-1", partnerName: "Partner" }),
    );
  });

  it("syncCompetitions calls API and does not throw on success", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    (api.post as jest.Mock).mockResolvedValue({});

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CompetitionProvider>{children}</CompetitionProvider>
    );
    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    await act(async () => {
      await result.current.syncCompetitions();
    });

    expect(api.post).toHaveBeenCalledWith("/competitions/sync");
  });

  it("syncCompetitions handles error gracefully", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    (api.post as jest.Mock).mockRejectedValue(new Error("Forbidden"));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CompetitionProvider>{children}</CompetitionProvider>
    );
    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    await act(async () => {
      await result.current.syncCompetitions();
    });

    expect(api.post).toHaveBeenCalledWith("/competitions/sync");
  });

  it("getCompetitionDetails fetches competition by id", async () => {
    const mockCompetition = {
      id: "comp-1",
      title: "Test Comp",
      events: [],
      schedule: [],
    };
    (api.get as jest.Mock).mockResolvedValue({ data: mockCompetition });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CompetitionProvider>{children}</CompetitionProvider>
    );
    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    let details;
    await act(async () => {
      details = await result.current.getCompetitionDetails("comp-1");
    });

    expect(api.get).toHaveBeenCalledWith("/competitions/comp-1");
    expect(details).toEqual(mockCompetition);
  });

  it("getResults fetches results by competition id", async () => {
    const mockResults = [{ id: "r1", eventId: "e1", ranking: 1 }];
    (api.get as jest.Mock).mockResolvedValue({ data: mockResults });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CompetitionProvider>{children}</CompetitionProvider>
    );
    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    let results;
    await act(async () => {
      results = await result.current.getResults("comp-1");
    });

    expect(api.get).toHaveBeenCalledWith("/competitions/comp-1/results");
    expect(results).toEqual(mockResults);
  });

  it("unregisterFromEvent calls API", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    (api.post as jest.Mock).mockResolvedValue({});

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CompetitionProvider>{children}</CompetitionProvider>
    );
    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    await act(async () => {
      await result.current.unregisterFromEvent("comp-1", "event-1");
    });

    expect(api.post).toHaveBeenCalledWith(
      "/competitions/comp-1/unregister",
      expect.objectContaining({ eventId: "event-1" }),
    );
  });

  it("getEventRegistrations fetches registrations", async () => {
    const mockRegistrations = [{ id: "reg-1", eventId: "event-1" }];
    (api.get as jest.Mock).mockResolvedValue({ data: mockRegistrations });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CompetitionProvider>{children}</CompetitionProvider>
    );
    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    let registrations;
    await act(async () => {
      registrations = await result.current.getEventRegistrations("event-1");
    });

    expect(api.get).toHaveBeenCalledWith(
      "/competitions/event/event-1/registrations",
    );
    expect(registrations).toEqual(mockRegistrations);
  });

  it("getUserRegistrations fetches user registrations", async () => {
    const mockUserRegistrations = [{ id: "reg-1", eventId: "e1" }];
    (api.get as jest.Mock).mockResolvedValue({ data: mockUserRegistrations });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CompetitionProvider>{children}</CompetitionProvider>
    );
    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    let userRegistrations;
    await act(async () => {
      userRegistrations = await result.current.getUserRegistrations();
    });

    expect(api.get).toHaveBeenCalledWith("/competitions/user/registrations");
    expect(userRegistrations).toEqual(mockUserRegistrations);
  });

  // ─── getCompetitions branches ────────────────────────────────────────────────

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <CompetitionProvider>{children}</CompetitionProvider>
  );

  describe("getCompetitions", () => {
    it("returns paginated data when API responds with {data, meta} object", async () => {
      const mockData = [{ id: "c1" }];
      const mockMeta = { total: 1, skip: 0, take: 10, hasMore: false };
      (api.get as jest.Mock).mockResolvedValue({
        data: { data: mockData, meta: mockMeta },
      });

      const { result } = await renderHook(() => useCompetitionRepository(), {
        wrapper,
      });

      let res: Awaited<ReturnType<typeof result.current.getCompetitions>>;
      await act(async () => {
        res = await result.current.getCompetitions(0, 10);
      });

      expect(res!.data).toEqual(mockData);
      expect(res!.meta).toEqual(mockMeta);
    });

    it("returns array data with hasMore:false when API responds with a plain array", async () => {
      const mockArray = [{ id: "c1" }, { id: "c2" }];
      (api.get as jest.Mock).mockResolvedValue({ data: mockArray });

      const { result } = await renderHook(() => useCompetitionRepository(), {
        wrapper,
      });

      let res: Awaited<ReturnType<typeof result.current.getCompetitions>>;
      await act(async () => {
        res = await result.current.getCompetitions();
      });

      expect(res!.data).toEqual(mockArray);
      expect(res!.meta).toEqual({ hasMore: false });
    });

    it("returns empty array when API responds with object but no data field", async () => {
      (api.get as jest.Mock).mockResolvedValue({ data: {} });

      const { result } = await renderHook(() => useCompetitionRepository(), {
        wrapper,
      });

      let res: Awaited<ReturnType<typeof result.current.getCompetitions>>;
      await act(async () => {
        res = await result.current.getCompetitions();
      });

      expect(res!.data).toEqual([]);
      expect(res!.meta).toEqual({ hasMore: false });
    });

    it("calls API with default offset and limit", async () => {
      (api.get as jest.Mock).mockResolvedValue({ data: [] });

      const { result } = await renderHook(() => useCompetitionRepository(), {
        wrapper,
      });

      await act(async () => {
        await result.current.getCompetitions();
      });

      expect(api.get).toHaveBeenCalledWith("/competitions?skip=0&take=10");
    });
  });

  // ─── remaining methods ───────────────────────────────────────────────────────

  it("getCompetitionDetailsForUser fetches /for-user endpoint", async () => {
    const mockComp = { id: "c1", events: [], schedule: [] };
    (api.get as jest.Mock).mockResolvedValue({ data: mockComp });

    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    let details;
    await act(async () => {
      details = await result.current.getCompetitionDetailsForUser!("c1");
    });

    expect(api.get).toHaveBeenCalledWith("/competitions/c1/for-user");
    expect(details).toEqual(mockComp);
  });

  it("getClubPendingRegistrations fetches pending registrations", async () => {
    const mockPending = [{ id: "pr-1" }];
    (api.get as jest.Mock).mockResolvedValue({ data: mockPending });

    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    let pending;
    await act(async () => {
      pending = await result.current.getClubPendingRegistrations();
    });

    expect(api.get).toHaveBeenCalledWith(
      "/competitions/club/pending-registrations",
    );
    expect(pending).toEqual(mockPending);
  });

  it("registerMember posts with eventId, userId, and partnerName", async () => {
    (api.post as jest.Mock).mockResolvedValue({});

    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    await act(async () => {
      await result.current.registerMember("event-1", "user-1", "Partner");
    });

    expect(api.post).toHaveBeenCalledWith("/competitions/register-member", {
      eventId: "event-1",
      userId: "user-1",
      partnerName: "Partner",
    });
  });

  it("confirmRegistration posts to confirm endpoint", async () => {
    (api.post as jest.Mock).mockResolvedValue({});

    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    await act(async () => {
      await result.current.confirmRegistration("reg-1");
    });

    expect(api.post).toHaveBeenCalledWith(
      "/competitions/registrations/reg-1/confirm",
    );
  });

  it("unregisterMember posts with eventId and userId", async () => {
    (api.post as jest.Mock).mockResolvedValue({});

    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    await act(async () => {
      await result.current.unregisterMember("event-1", "user-1");
    });

    expect(api.post).toHaveBeenCalledWith("/competitions/unregister-member", {
      eventId: "event-1",
      userId: "user-1",
    });
  });

  it("registerForEvent works without partnerName", async () => {
    (api.post as jest.Mock).mockResolvedValue({});

    const { result } = await renderHook(() => useCompetitionRepository(), {
      wrapper,
    });

    await act(async () => {
      await result.current.registerForEvent("comp-1", "event-1");
    });

    expect(api.post).toHaveBeenCalledWith(
      "/competitions/comp-1/register",
      expect.objectContaining({ eventId: "event-1" }),
    );
  });
});
