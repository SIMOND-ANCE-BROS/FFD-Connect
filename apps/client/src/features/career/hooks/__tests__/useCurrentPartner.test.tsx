import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import {
  CareerApi,
  type CareerPartnership,
} from "../../../../services/api/career-api";
import * as AuthContext from "../../../auth/context/AuthContext";
import {
  getCurrentPartnerName,
  toCurrentPartner,
  useCurrentPartner,
} from "../useCurrentPartner";

jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));
jest.mock("../../../../services/api/career-api", () => ({
  CareerApi: { getMyCareer: jest.fn() },
}));

const getMyCareer = CareerApi.getMyCareer as jest.Mock;
const getAuthConfig = jest.fn();

const partnership = (
  overrides: Partial<CareerPartnership> = {},
): CareerPartnership => ({
  id: "p1",
  status: "ACTIVE",
  startDate: "2026-01-01",
  endDate: null,
  partner: {
    id: "u2",
    firstName: "Jeanne",
    lastName: "Martin",
    clubName: null,
  },
  clubName: "Club",
  secondaryClubName: null,
  isCurrent: true,
  ...overrides,
});

describe("getCurrentPartnerName / toCurrentPartner", () => {
  it("names the current partner, ignoring past ones", () => {
    const past = partnership({
      id: "p0",
      isCurrent: false,
      partner: { id: "u1", firstName: "Paul", lastName: "Old", clubName: null },
    });
    expect(getCurrentPartnerName([past, partnership()])).toBe("Jeanne Martin");
    expect(toCurrentPartner([past, partnership()])).toEqual({
      status: "registered",
      name: "Jeanne Martin",
    });
  });

  it("reports no partner when none is current", () => {
    const past = partnership({ isCurrent: false });
    expect(getCurrentPartnerName([past])).toBeNull();
    expect(toCurrentPartner([past])).toEqual({ status: "none" });
    expect(toCurrentPartner([])).toEqual({ status: "none" });
  });

  it("keeps a current partner whose name was scrubbed", () => {
    const scrubbed = partnership({
      partner: { id: "u2", firstName: "", lastName: "", clubName: null },
    });
    expect(toCurrentPartner([scrubbed])).toEqual({
      status: "registered",
      name: "",
    });
  });

  it("is unknown before the career is loaded", () => {
    expect(toCurrentPartner(undefined)).toEqual({ status: "unknown" });
  });
});

describe("useCurrentPartner", () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    (AuthContext.useAuthRepository as jest.Mock).mockReturnValue({
      getAuthConfig,
    });
    getAuthConfig.mockResolvedValue({ authToken: "tok", isLoggedIn: true });
  });

  afterEach(() => queryClient.clear());

  it("loads the career with the session token", async () => {
    getMyCareer.mockResolvedValue({
      partnerships: [partnership()],
      registrations: [],
      results: [],
    });
    const { result } = await renderHook(() => useCurrentPartner(true), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        status: "registered",
        name: "Jeanne Martin",
      }),
    );
    expect(getMyCareer).toHaveBeenCalledWith("tok");
  });

  it("reports no partner from an empty career", async () => {
    getMyCareer.mockResolvedValue({
      partnerships: [],
      registrations: [],
      results: [],
    });
    const { result } = await renderHook(() => useCurrentPartner(true), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toEqual({ status: "none" }));
  });

  it("stays unknown when the career cannot be loaded", async () => {
    getMyCareer.mockRejectedValue(new Error("offline"));
    const { result } = await renderHook(() => useCurrentPartner(true), {
      wrapper,
    });
    await waitFor(() => expect(getMyCareer).toHaveBeenCalled());
    expect(result.current).toEqual({ status: "unknown" });
  });

  it("does not call the API without a session token", async () => {
    getAuthConfig.mockResolvedValue({ authToken: null, isLoggedIn: false });
    const { result } = await renderHook(() => useCurrentPartner(true), {
      wrapper,
    });
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    expect(getMyCareer).not.toHaveBeenCalled();
    expect(result.current).toEqual({ status: "unknown" });
  });

  it("does nothing when disabled (not a licensee)", async () => {
    const { result } = await renderHook(() => useCurrentPartner(false), {
      wrapper,
    });
    expect(result.current).toEqual({ status: "unknown" });
    expect(getAuthConfig).not.toHaveBeenCalled();
    expect(getMyCareer).not.toHaveBeenCalled();
  });
});
