import { PrivacyPolicyApi } from "../../services/api/privacy-policy-api";
import { usePrivacyPolicyNoticeStore } from "../privacyPolicyNotice.store";

jest.mock("../../services/api/privacy-policy-api", () => ({
  PrivacyPolicyApi: { pendingVersion: jest.fn(), acknowledge: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), error: jest.fn() }),
}));

const pendingVersion = PrivacyPolicyApi.pendingVersion as jest.Mock;
const acknowledge = PrivacyPolicyApi.acknowledge as jest.Mock;

describe("privacyPolicyNotice store (#734)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePrivacyPolicyNoticeStore.getState().reset();
  });

  it("holds the version the server asks to announce", async () => {
    pendingVersion.mockResolvedValue("2026-10-17");
    await usePrivacyPolicyNoticeStore.getState().check();
    expect(usePrivacyPolicyNoticeStore.getState().pendingVersion).toBe(
      "2026-10-17",
    );
  });

  it("hides the notice at once and acknowledges that version", async () => {
    pendingVersion.mockResolvedValue("2026-10-17");
    await usePrivacyPolicyNoticeStore.getState().check();
    let resolveAck: (saved: boolean) => void = () => {};
    acknowledge.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveAck = resolve;
      }),
    );

    const pending = usePrivacyPolicyNoticeStore.getState().acknowledge();
    // Optimistic: gone before the server answers (cold start).
    expect(usePrivacyPolicyNoticeStore.getState().pendingVersion).toBeNull();
    resolveAck(true);
    await pending;

    expect(acknowledge).toHaveBeenCalledWith("2026-10-17");
  });

  it("stays hidden for the session when the acknowledgement fails", async () => {
    pendingVersion.mockResolvedValue("2026-10-17");
    acknowledge.mockResolvedValue(false);
    await usePrivacyPolicyNoticeStore.getState().check();

    await usePrivacyPolicyNoticeStore.getState().acknowledge();

    expect(usePrivacyPolicyNoticeStore.getState().pendingVersion).toBeNull();
  });

  it("acknowledges nothing when nothing is pending", async () => {
    await usePrivacyPolicyNoticeStore.getState().acknowledge();
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
