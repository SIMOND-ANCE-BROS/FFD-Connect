import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as AuthContext from "../../../auth/context/AuthContext";
import { BackendService } from "../../../../services/BackendService";
import { useCareerLogic } from "../useCareerLogic";

jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));

jest.mock("../../../../services/BackendService", () => ({
  BackendService: {
    getMyCareer: jest.fn(),
  },
}));

const mockWithErrorHandling = jest.fn(async (fn: () => Promise<void>) => {
  await fn();
});

jest.mock("../../../../hooks/useErrorHandler", () => ({
  useErrorHandler: () => ({ withErrorHandling: mockWithErrorHandling }),
}));

const mockGetMyCareer = BackendService.getMyCareer as jest.MockedFunction<
  typeof BackendService.getMyCareer
>;

const mockCareerData = {
  partnerships: [{ id: "p1" } as never],
  registrations: [{ id: "r1" } as never],
  results: [{ id: "res1" } as never],
};

describe("useCareerLogic", () => {
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

  describe("when not authenticated", () => {
    it("clears data and stops loading when authToken is missing", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({
        authToken: null,
        isLoggedIn: false,
      });

      const { result } = await renderHook(() => useCareerLogic());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.partnerships).toEqual([]);
      expect(result.current.registrations).toEqual([]);
      expect(result.current.results).toEqual([]);
      expect(mockGetMyCareer).not.toHaveBeenCalled();
    });

    it("clears data and stops loading when isLoggedIn is false", async () => {
      mockAuth.getAuthConfig.mockResolvedValue({
        authToken: "token",
        isLoggedIn: false,
      });

      const { result } = await renderHook(() => useCareerLogic());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.partnerships).toEqual([]);
      expect(mockGetMyCareer).not.toHaveBeenCalled();
    });
  });

  describe("when authenticated", () => {
    beforeEach(() => {
      mockAuth.getAuthConfig.mockResolvedValue({
        authToken: "token-abc",
        isLoggedIn: true,
      });
    });

    it("loads career data and updates state", async () => {
      mockGetMyCareer.mockResolvedValue(mockCareerData);

      const { result } = await renderHook(() => useCareerLogic());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockGetMyCareer).toHaveBeenCalledWith("token-abc");
      expect(result.current.partnerships).toEqual(mockCareerData.partnerships);
      expect(result.current.registrations).toEqual(
        mockCareerData.registrations,
      );
      expect(result.current.results).toEqual(mockCareerData.results);
    });

    it("sets loading to false after fetch completes", async () => {
      mockGetMyCareer.mockResolvedValue(mockCareerData);

      const { result } = await renderHook(() => useCareerLogic());

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it("re-fetches data when refresh is called", async () => {
      mockGetMyCareer.mockResolvedValue(mockCareerData);

      const { result } = await renderHook(() => useCareerLogic());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const callsBefore = mockGetMyCareer.mock.calls.length;

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockGetMyCareer.mock.calls.length).toBe(callsBefore + 1);
    });

    it("never flags the first load as a pull-to-refresh", async () => {
      mockGetMyCareer.mockResolvedValue(mockCareerData);

      const { result } = await renderHook(() => useCareerLogic());

      // First load: the screen's own loader, not the RefreshControl spinner.
      expect(result.current.refreshing).toBe(false);
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.refreshing).toBe(false);
    });

    it("flags refreshing only while a pull-to-refresh is in flight", async () => {
      mockGetMyCareer.mockResolvedValue(mockCareerData);
      const { result } = await renderHook(() => useCareerLogic());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let resolveFetch: (v: typeof mockCareerData) => void = () => {};
      mockGetMyCareer.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      let pending: Promise<void> = Promise.resolve();
      await act(async () => {
        pending = result.current.refresh();
      });
      await waitFor(() => expect(result.current.refreshing).toBe(true));

      await act(async () => {
        resolveFetch(mockCareerData);
        await pending;
      });
      expect(result.current.refreshing).toBe(false);
    });
  });

  describe("first load vs pull-to-refresh", () => {
    const emptyCareer = { partnerships: [], registrations: [], results: [] };

    beforeEach(() => {
      mockAuth.getAuthConfig.mockResolvedValue({
        authToken: "token-abc",
        isLoggedIn: true,
      });
    });

    it("flags only the very first load as isFirstLoad", async () => {
      let resolveFetch: (v: typeof emptyCareer) => void = () => {};
      mockGetMyCareer.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const { result } = await renderHook(() => useCareerLogic());
      await waitFor(() => expect(mockGetMyCareer).toHaveBeenCalled());
      expect(result.current.isFirstLoad).toBe(true);

      await act(async () => {
        resolveFetch(emptyCareer);
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.isFirstLoad).toBe(false);
    });

    it("never flags a pull-to-refresh on an empty career as isFirstLoad", async () => {
      mockGetMyCareer.mockResolvedValue(emptyCareer);
      const { result } = await renderHook(() => useCareerLogic());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let resolveFetch: (v: typeof emptyCareer) => void = () => {};
      mockGetMyCareer.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );
      let pending: Promise<void> = Promise.resolve();
      await act(async () => {
        pending = result.current.refresh();
      });
      await waitFor(() => expect(result.current.loading).toBe(true));
      expect(result.current.refreshing).toBe(true);
      expect(result.current.isFirstLoad).toBe(false);

      await act(async () => {
        resolveFetch(emptyCareer);
        await pending;
      });
      expect(result.current.isFirstLoad).toBe(false);
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

      const { result } = await renderHook(() => useCareerLogic());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.partnerships).toEqual([]);
    });
  });
});
