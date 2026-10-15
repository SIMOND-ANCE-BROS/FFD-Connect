import { act, renderHook } from "@testing-library/react-native";
import { useAuthRepository } from "../../features/auth/context/AuthContext";
import { useAuthStore } from "../../stores/auth.store";
import {
  type AuthReturnTarget,
  useAuthReturnStore,
} from "../../stores/authReturn.store";
import { nextAuthReturnStep, useSignInAndReturn } from "../authReturn";

jest.mock("../../features/auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const target: AuthReturnTarget = {
  screen: "CompetitionDetail",
  params: { competitionId: "comp-1" },
};

describe("nextAuthReturnStep", () => {
  it.each([
    [null, false, target, "wait"],
    [false, false, target, "wait"],
    [true, false, null, "wait"],
    [true, true, null, "wait"],
    [true, true, target, "drop"],
    [true, false, target, "navigate"],
  ] as const)(
    "isLoggedIn=%s isGuest=%s target=%j → %s",
    (isLoggedIn, isGuest, t, expected) => {
      expect(nextAuthReturnStep(isLoggedIn, isGuest, t)).toBe(expected);
    },
  );
});

describe("useSignInAndReturn", () => {
  const logout = jest.fn<Promise<void>, []>();
  const refreshAuth = jest.fn<Promise<void>, []>();
  const realRefreshAuth = useAuthStore.getState().refreshAuth;

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthReturnStore.setState({ target: null });
    (useAuthRepository as jest.Mock).mockReturnValue({ logout });
    useAuthStore.setState({ refreshAuth });
  });

  afterAll(() => {
    useAuthStore.setState({ refreshAuth: realRefreshAuth });
  });

  it("ends the guest session, then stores the return target", async () => {
    const calls: string[] = [];
    logout.mockImplementation(async () => {
      calls.push("logout");
    });
    refreshAuth.mockImplementation(async () => {
      // While the guest session is switching, no target yet: the navigator
      // would read « guest + target » as « back in guest mode » and drop it.
      calls.push(
        `refresh:${useAuthReturnStore.getState().target === null ? "null" : "set"}`,
      );
    });

    const { result } = await renderHook(() => useSignInAndReturn());
    await act(async () => {
      await result.current(target);
    });

    expect(calls).toEqual(["logout", "refresh:null"]);
    expect(useAuthReturnStore.getState().target).toEqual(target);
  });

  it("stores nothing when leaving guest mode fails", async () => {
    logout.mockRejectedValue(new Error("storage down"));

    const { result } = await renderHook(() => useSignInAndReturn());
    await act(async () => {
      await result.current(target);
    });

    expect(refreshAuth).not.toHaveBeenCalled();
    expect(useAuthReturnStore.getState().target).toBeNull();
  });
});
