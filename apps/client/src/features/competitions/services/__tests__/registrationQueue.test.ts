import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { AxiosError, type AxiosResponse } from "axios";
import { Alert } from "react-native";
import {
  loadQueue,
  type PendingMutation,
} from "../../../../services/offlineQueueStorage";
import { useOfflineQueueStore } from "../../../../stores/offlineQueue.store";
import {
  cancelDeadlineNotificationForCompetition,
  clearDeadlineMarker,
} from "../../../../utils/scheduleDeadlineNotification";
import {
  QUEUE_MESSAGES,
  RegistrationDeadlinePassedError,
  applyPendingRegistrations,
  assertReplayable,
  classifyRegistrationReplayError,
  enqueueRegistrationAction,
  getPendingRegistrationActions,
  handleRegistrationReplayError,
  handleRegistrationReplaySuccess,
  isDeadlinePassed,
  isDeviceOffline,
  isNetworkError,
  submitRegistrationAction,
} from "../registrationQueue";

jest.mock("../../../../utils/scheduleDeadlineNotification", () => ({
  cancelDeadlineNotificationForCompetition: jest
    .fn()
    .mockResolvedValue(undefined),
  clearDeadlineMarker: jest.fn().mockResolvedValue(undefined),
}));

const mockFetch = NetInfo.fetch as jest.Mock;
const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

const target = { competitionId: "c1", eventId: "e1", partnerName: "Jean" };
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

const networkError = () => new AxiosError("Network Error", "ERR_NETWORK");
const httpError = (status: number, data: unknown = {}) =>
  new AxiosError("HTTP", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    data,
    statusText: "",
    headers: {},
    config: {},
  } as AxiosResponse);

const mutation = (
  action: "register" | "unregister",
  meta: Record<string, string> = {},
): PendingMutation => ({
  id: "m1",
  endpoint: `POST /competitions/c1/${action}`,
  payload: { eventId: "e1" },
  queryKeysToInvalidate: [],
  enqueuedAt: 0,
  kind: "registration",
  collapseKey: "registration:c1:e1",
  meta: { action, competitionId: "c1", eventId: "e1", ...meta },
});

beforeEach(async () => {
  await AsyncStorage.clear();
  useOfflineQueueStore.getState().setItems([]);
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
});

describe("submitRegistrationAction", () => {
  it("sends directly when online", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    await expect(
      submitRegistrationAction("register", target, send, []),
    ).resolves.toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await loadQueue()).toHaveLength(0);
  });

  it("enqueues without calling the API when offline", async () => {
    mockFetch.mockResolvedValue({ isConnected: false });
    const send = jest.fn();
    await expect(
      submitRegistrationAction("register", target, send, []),
    ).resolves.toEqual({ status: "queued" });
    expect(send).not.toHaveBeenCalled();
    const [queued] = await loadQueue();
    expect(queued).toMatchObject({
      endpoint: "POST /competitions/c1/register",
      // DTO-only body (backend forbids unknown fields)
      payload: { eventId: "e1", partnerName: "Jean" },
      kind: "registration",
      meta: { action: "register", competitionId: "c1", eventId: "e1" },
      queryKeysToInvalidate: [["myRegistrations"], ["competition", "c1"]],
    });
  });

  it("treats 'connected but no internet' as offline", async () => {
    mockFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: false,
    });
    const send = jest.fn();
    await expect(
      submitRegistrationAction("unregister", target, send, []),
    ).resolves.toEqual({ status: "queued" });
    const [queued] = await loadQueue();
    // no partnerName on unregister
    expect(queued.payload).toEqual({ eventId: "e1" });
  });

  it("falls back to the queue on a network error", async () => {
    const send = jest.fn().mockRejectedValue(networkError());
    await expect(
      submitRegistrationAction("register", target, send, []),
    ).resolves.toEqual({ status: "queued" });
    expect(await loadQueue()).toHaveLength(1);
  });

  it.each([400, 403, 409, 500])(
    "rethrows a %i server answer without queuing",
    async (status) => {
      const err = httpError(status);
      const send = jest.fn().mockRejectedValue(err);
      await expect(
        submitRegistrationAction("register", target, send, []),
      ).rejects.toBe(err);
      expect(await loadQueue()).toHaveLength(0);
    },
  );

  it("does not queue a cancelled request", async () => {
    const err = new AxiosError("canceled", "ERR_CANCELED");
    const send = jest.fn().mockRejectedValue(err);
    await expect(
      submitRegistrationAction("register", target, send, []),
    ).rejects.toBe(err);
  });

  it("routes through the queue (collapse) when the event already has a pending action, even online", async () => {
    mockFetch.mockResolvedValue({ isConnected: false });
    await submitRegistrationAction("register", target, jest.fn(), []);
    mockFetch.mockResolvedValue({ isConnected: true });
    const send = jest.fn();
    await expect(
      submitRegistrationAction(
        "unregister",
        target,
        send,
        useOfflineQueueStore.getState().items,
      ),
    ).resolves.toEqual({ status: "collapsed" });
    expect(send).not.toHaveBeenCalled();
    expect(await loadQueue()).toHaveLength(0);
  });

  it("reports a duplicate instead of enqueuing twice", async () => {
    mockFetch.mockResolvedValue({ isConnected: false });
    await submitRegistrationAction("register", target, jest.fn(), []);
    await expect(
      submitRegistrationAction(
        "register",
        target,
        jest.fn(),
        useOfflineQueueStore.getState().items,
      ),
    ).resolves.toEqual({ status: "duplicate" });
    expect(await loadQueue()).toHaveLength(1);
  });

  it("refuses to queue a register once the deadline has passed", async () => {
    mockFetch.mockResolvedValue({ isConnected: false });
    await expect(
      submitRegistrationAction(
        "register",
        { ...target, registrationDeadline: PAST },
        jest.fn(),
        [],
      ),
    ).rejects.toBeInstanceOf(RegistrationDeadlinePassedError);
    expect(await loadQueue()).toHaveLength(0);
  });

  it("still queues an unregister after the deadline", async () => {
    mockFetch.mockResolvedValue({ isConnected: false });
    await expect(
      submitRegistrationAction(
        "unregister",
        { ...target, registrationDeadline: PAST },
        jest.fn(),
        [],
      ),
    ).resolves.toEqual({ status: "queued" });
  });

  it("stores the deadline for the replay-time guard", async () => {
    await enqueueRegistrationAction("register", {
      ...target,
      registrationDeadline: FUTURE,
    });
    const [queued] = await loadQueue();
    expect(queued.meta?.registrationDeadline).toBe(FUTURE);
  });
});

describe("helpers", () => {
  it("isDeviceOffline is optimistic when NetInfo throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("no native module"));
    await expect(isDeviceOffline()).resolves.toBe(false);
  });

  it("isNetworkError only matches axios errors without a response", () => {
    expect(isNetworkError(networkError())).toBe(true);
    expect(isNetworkError(httpError(500))).toBe(false);
    expect(isNetworkError(new Error("Network Error"))).toBe(false);
  });

  it("isDeadlinePassed handles missing and invalid dates", () => {
    expect(isDeadlinePassed(undefined)).toBe(false);
    expect(isDeadlinePassed("not-a-date")).toBe(false);
    expect(isDeadlinePassed(PAST)).toBe(true);
    expect(isDeadlinePassed(FUTURE)).toBe(false);
  });

  it("derives the effective pending action per event (last entry wins)", () => {
    const items: PendingMutation[] = [
      mutation("register"),
      { ...mutation("unregister"), id: "m2" },
      {
        ...mutation("register", { competitionId: "c2", eventId: "x" }),
        id: "m3",
      },
      { ...mutation("register"), id: "m4", kind: undefined },
    ];
    expect(getPendingRegistrationActions(items, "c1")).toEqual({
      e1: "unregister",
    });
    expect(getPendingRegistrationActions(items, "c2")).toEqual({
      x: "register",
    });
  });

  it("overlays pending actions on server registrations", () => {
    expect(
      applyPendingRegistrations(["a", "b"], { b: "unregister", c: "register" }),
    ).toEqual(["a", "c"]);
  });

  it("assertReplayable blocks a register whose deadline passed while offline", () => {
    expect(() =>
      assertReplayable(mutation("register", { registrationDeadline: PAST })),
    ).toThrow(RegistrationDeadlinePassedError);
    expect(() =>
      assertReplayable(mutation("unregister", { registrationDeadline: PAST })),
    ).not.toThrow();
    expect(() =>
      assertReplayable(mutation("register", { registrationDeadline: FUTURE })),
    ).not.toThrow();
  });
});

describe("classifyRegistrationReplayError", () => {
  it.each([
    ["network error", networkError()],
    ["500", httpError(500)],
    ["503", httpError(503)],
    ["408", httpError(408)],
    ["429", httpError(429)],
    ["non-axios error", new Error("boom")],
  ])("retries transient failures (%s)", (_label, err) => {
    expect(classifyRegistrationReplayError(mutation("register"), err)).toEqual({
      decision: "retry",
    });
  });

  it("drops on deadline passed", () => {
    expect(
      classifyRegistrationReplayError(
        mutation("register"),
        new RegistrationDeadlinePassedError(),
      ),
    ).toEqual({
      decision: "drop",
      message: QUEUE_MESSAGES.DEADLINE_PASSED_ON_REPLAY,
    });
  });

  it("drops on 401 (silent refresh already failed)", () => {
    expect(
      classifyRegistrationReplayError(mutation("register"), httpError(401)),
    ).toEqual({ decision: "drop", message: QUEUE_MESSAGES.SESSION_EXPIRED });
  });

  it("drops on 409 already registered", () => {
    expect(
      classifyRegistrationReplayError(mutation("register"), httpError(409)),
    ).toEqual({ decision: "drop", message: QUEUE_MESSAGES.ALREADY_REGISTERED });
  });

  it("drops a 409 on unregister with the server message", () => {
    expect(
      classifyRegistrationReplayError(
        mutation("unregister"),
        httpError(409, { message: "Conflit" }),
      ),
    ).toEqual({ decision: "drop", message: "Conflit" });
    expect(
      classifyRegistrationReplayError(mutation("unregister"), httpError(409)),
    ).toEqual({ decision: "drop", message: QUEUE_MESSAGES.UNREGISTER_REFUSED });
  });

  it("drops on 404 with an action-specific message", () => {
    expect(
      classifyRegistrationReplayError(mutation("unregister"), httpError(404)),
    ).toEqual({
      decision: "drop",
      message: QUEUE_MESSAGES.ALREADY_UNREGISTERED,
    });
    expect(
      classifyRegistrationReplayError(mutation("register"), httpError(404)),
    ).toEqual({ decision: "drop", message: QUEUE_MESSAGES.EVENT_NOT_FOUND });
  });

  it("drops a full event / refused registration with the server message", () => {
    expect(
      classifyRegistrationReplayError(
        mutation("register"),
        httpError(422, { message: ["Épreuve complète"] }),
      ),
    ).toEqual({
      decision: "drop",
      message: `${QUEUE_MESSAGES.REGISTER_REFUSED}\nÉpreuve complète`,
    });
    expect(
      classifyRegistrationReplayError(
        mutation("register"),
        httpError(403, {
          message: "Votre club n'autorise pas les inscriptions",
        }),
      ).message,
    ).toContain("Votre club n'autorise pas");
    expect(
      classifyRegistrationReplayError(mutation("unregister"), httpError(400)),
    ).toEqual({ decision: "drop", message: QUEUE_MESSAGES.UNREGISTER_REFUSED });
  });
});

describe("engine handlers", () => {
  it("ignores non-registration mutations", () => {
    const other = { ...mutation("register"), kind: undefined };
    expect(
      handleRegistrationReplayError(other, httpError(400)),
    ).toBeUndefined();
    handleRegistrationReplaySuccess(other);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("alerts the user when a replay is dropped", () => {
    expect(
      handleRegistrationReplayError(mutation("register"), httpError(409)),
    ).toBe("drop");
    expect(alertSpy).toHaveBeenCalledWith(
      QUEUE_MESSAGES.REPLAY_REJECTED_TITLE,
      QUEUE_MESSAGES.ALREADY_REGISTERED,
    );
  });

  it("stays silent on a transient failure", () => {
    expect(
      handleRegistrationReplayError(mutation("register"), networkError()),
    ).toBe("retry");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("mirrors the online side effects on replay success", () => {
    handleRegistrationReplaySuccess(mutation("register"));
    expect(cancelDeadlineNotificationForCompetition).toHaveBeenCalledWith("c1");
    expect(alertSpy).toHaveBeenCalledWith(
      QUEUE_MESSAGES.REPLAYED_TITLE,
      QUEUE_MESSAGES.REPLAYED_REGISTER,
    );

    handleRegistrationReplaySuccess(mutation("unregister"));
    expect(clearDeadlineMarker).toHaveBeenCalledWith("c1");
    expect(alertSpy).toHaveBeenCalledWith(
      QUEUE_MESSAGES.REPLAYED_TITLE,
      QUEUE_MESSAGES.REPLAYED_UNREGISTER,
    );
  });
});
