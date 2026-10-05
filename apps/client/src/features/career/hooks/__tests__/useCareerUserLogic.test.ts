import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as AuthContext from "../../../auth/context/AuthContext";
import { BackendService } from "../../../../services/BackendService";
import { useCareerUserLogic } from "../useCareerUserLogic";

jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));

jest.mock("../../../../services/BackendService", () => ({
  BackendService: {
    getUserCareer: jest.fn(),
  },
}));

const mockWithErrorHandling = jest.fn(async (fn: () => Promise<void>) => {
  await fn();
});

jest.mock("../../../../hooks/useErrorHandler", () => ({
  useErrorHandler: () => ({ withErrorHandling: mockWithErrorHandling }),
}));

const mockGetUserCareer = BackendService.getUserCareer as jest.MockedFunction<
  typeof BackendService.getUserCareer
>;

const mockCareerData = {
  partnerships: [{ id: "p1" } as never],
  registrations: [{ id: "r1" } as never],
  results: [{ id: "res1" } as never],
};

describe("useCareerUserLogic", () => {
  const mockAuth = {
    getAuthConfig: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWithErrorHandling.mockImplementation(
      async (fn: () => Promise<void>) => {
        await fn();
      },
    );
    (AuthContext.useAuthRepository as jest.Mock).mockReturnValue(mockAuth);
  });

  describe("when userId is null", () => {
    it("clears data immediately and sets loading to false", async () => {
      const { result } = await renderHook(() => useCareerUserLogic(null));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.partnerships).toEqual([]);
      expect(result.current.registrations).toEqual([]);
      expect(result.current.results).toEqual([]);
      expect(mockGetUserCareer).not.toHaveBeenCalled();
    });

    it("starts with loading=false when userId is null", async () => {
      const { result } = await renderHook(() => useCareerUserLogic(null));
      // initial state: loading = !!userId = false
      expect(result.current.loading).toBe(false);
    });
  });

  describe("when userId is provided but user is not authenticated", () => {
    it("stops loading without fetching when authToken is missing", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({
        authToken: null,
        isLoggedIn: false,
      });

      const { result } = await renderHook(() => useCareerUserLogic("user-123"));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockGetUserCareer).not.toHaveBeenCalled();
      expect(result.current.partnerships).toEqual([]);
    });

    it("stops loading when isLoggedIn is false", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({
        authToken: "token",
        isLoggedIn: false,
      });

      const { result } = await renderHook(() => useCareerUserLogic("user-123"));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockGetUserCareer).not.toHaveBeenCalled();
    });
  });

  describe("when userId is provided and user is authenticated", () => {
    beforeEach(() => {
      mockAuth.getAuthConfig.mockResolvedValue({
        authToken: "token-abc",
        isLoggedIn: true,
      });
    });

    it("loads career data for the given user", async () => {
      mockGetUserCareer.mockResolvedValue(mockCareerData);

      const { result } = await renderHook(() => useCareerUserLogic("user-123"));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockGetUserCareer).toHaveBeenCalledWith("token-abc", "user-123");
      expect(result.current.partnerships).toEqual(mockCareerData.partnerships);
      expect(result.current.registrations).toEqual(
        mockCareerData.registrations,
      );
      expect(result.current.results).toEqual(mockCareerData.results);
    });

    it("starts with loading=true when userId is provided", async () => {
      // Fetch laissé pendant : en v14 `await renderHook` draine les effets, donc
      // pour observer l'état de chargement initial (loading = !!userId), le fetch
      // ne doit pas s'être résolu. mockResolvedValue le résoudrait → loading false.
      mockGetUserCareer.mockReturnValue(new Promise(() => {}));
      const { result } = await renderHook(() => useCareerUserLogic("user-123"));
      expect(result.current.loading).toBe(true);
    });

    it("re-fetches data when refresh is called", async () => {
      mockGetUserCareer.mockResolvedValue(mockCareerData);

      const { result } = await renderHook(() => useCareerUserLogic("user-123"));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const callsBefore = mockGetUserCareer.mock.calls.length;

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockGetUserCareer.mock.calls.length).toBe(callsBefore + 1);
    });
  });

  describe("when fetch fails", () => {
    it("stops loading even when withErrorHandling swallows the error", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({
        authToken: "token-abc",
        isLoggedIn: true,
      });
      mockWithErrorHandling.mockImplementation(async () => {
        // error swallowed — data never set
      });

      const { result } = await renderHook(() => useCareerUserLogic("user-123"));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.partnerships).toEqual([]);
    });
  });
});
