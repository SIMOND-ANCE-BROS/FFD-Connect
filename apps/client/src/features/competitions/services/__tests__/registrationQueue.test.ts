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
  EXHAUSTED_REASONS,
  QUEUE_MESSAGES,
  REFUSAL_REASONS,
  RegistrationDeadlinePassedError,
  beginRegistrationReplayBatch,
  buildReplayRecap,
  endRegistrationReplayBatch,
  eventRecapLabel,
  activeRegistrationEventIds,
  applyPendingRegistrations,
  assertReplayable,
  buildExhaustedAlert,
  classifyRegistrationReplayError,
  enqueueRegistrationAction,
  getPendingRegistrationActions,
  handleRegistrationReplayError,
  handleRegistrationReplayExhausted,
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
  it("returns what the direct call resolved with when sent", async () => {
    const send = jest.fn().mockResolvedValue("PENDING");
    await expect(
      submitRegistrationAction("register", target, send, []),
    ).resolves.toEqual({ status: "sent", result: "PENDING" });
  });

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

  it("stores the names for the replay recap, never in the request (#859)", async () => {
    await enqueueRegistrationAction("register", {
      ...target,
      competitionTitle: "Open de Lyon",
      eventLabel: "Latines Adultes C",
    });
    const [queued] = await loadQueue();
    expect(queued.meta).toMatchObject({
      competitionTitle: "Open de Lyon",
      eventLabel: "Latines Adultes C",
    });
    // The backend runs forbidNonWhitelisted: the body stays DTO-only.
    expect(queued.payload).toEqual({ eventId: "e1", partnerName: "Jean" });
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

  it("ignores cancelled registrations (unregistered, #549)", () => {
    expect(
      activeRegistrationEventIds([
        { eventId: "a", status: "CONFIRMED" },
        { eventId: "b", status: "CANCELLED" },
        { eventId: "c", status: "PENDING" },
        { eventId: "d" },
      ]),
    ).toEqual(["a", "c", "d"]);
    expect(activeRegistrationEventIds(undefined)).toEqual([]);
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
      reason: REFUSAL_REASONS.DEADLINE_PASSED,
    });
  });

  it("drops on 401 (silent refresh already failed)", () => {
    expect(
      classifyRegistrationReplayError(mutation("register"), httpError(401)),
    ).toEqual({
      decision: "drop",
      message: QUEUE_MESSAGES.SESSION_EXPIRED,
      reason: REFUSAL_REASONS.SESSION_EXPIRED,
    });
  });

  it("drops on 409 already registered", () => {
    expect(
      classifyRegistrationReplayError(mutation("register"), httpError(409)),
    ).toEqual({
      decision: "drop",
      message: QUEUE_MESSAGES.ALREADY_REGISTERED,
      reason: REFUSAL_REASONS.ALREADY_REGISTERED,
    });
  });

  it("drops a 409 on unregister with the server message", () => {
    expect(
      classifyRegistrationReplayError(
        mutation("unregister"),
        httpError(409, { message: "Conflit" }),
      ),
    ).toEqual({ decision: "drop", message: "Conflit", reason: "Conflit" });
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
      reason: REFUSAL_REASONS.ALREADY_UNREGISTERED,
    });
    expect(
      classifyRegistrationReplayError(mutation("register"), httpError(404)),
    ).toEqual({
      decision: "drop",
      message: QUEUE_MESSAGES.EVENT_NOT_FOUND,
      reason: REFUSAL_REASONS.EVENT_NOT_FOUND,
    });
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
      reason: "Épreuve complète",
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

describe("replay exhausted (#874)", () => {
  const named = {
    competitionTitle: "Open de Lyon",
    eventLabel: "Latines Adultes C",
  };

  it("names the competition and event, gives the reason and invites a retry", () => {
    expect(
      buildExhaustedAlert(mutation("register", named), httpError(503)),
    ).toEqual({
      title: QUEUE_MESSAGES.EXHAUSTED_TITLE,
      message: [
        "Votre inscription en attente n'a pas pu être envoyée :",
        `• Open de Lyon — Latines Adultes C : inscription abandonnée. Motif : ${EXHAUSTED_REASONS.SERVER_ERROR} malgré plusieurs tentatives`,
        QUEUE_MESSAGES.EXHAUSTED_RETRY_REGISTER,
      ].join("\n"),
    });
  });

  it("words an abandoned unregister as such", () => {
    const { message } = buildExhaustedAlert(
      mutation("unregister", named),
      networkError(),
    );
    expect(message).toContain(
      "Votre désinscription en attente n'a pas pu être envoyée",
    );
    expect(message).toContain("désinscription abandonnée");
    expect(message).toContain(EXHAUSTED_REASONS.UNREACHABLE);
    expect(message).toContain(QUEUE_MESSAGES.EXHAUSTED_RETRY_UNREGISTER);
  });

  it("falls back to a generic name when the entry carries none", () => {
    const { message } = buildExhaustedAlert(
      mutation("register"),
      httpError(408),
    );
    expect(message).toContain(
      `• ${QUEUE_MESSAGES.EXHAUSTED_UNNAMED_EVENT} : inscription abandonnée`,
    );
    expect(message).toContain(EXHAUSTED_REASONS.UNREACHABLE);
  });

  it("keeps the event label alone when the title is missing", () => {
    const { message } = buildExhaustedAlert(
      mutation("register", { eventLabel: "Standard Juniors B" }),
      httpError(429),
    );
    expect(message).toContain("• Standard Juniors B : inscription abandonnée");
    expect(message).toContain(EXHAUSTED_REASONS.OVERLOADED);
  });

  it("alerts the user for a registration entry", () => {
    handleRegistrationReplayExhausted(
      mutation("register", named),
      httpError(500),
    );
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      QUEUE_MESSAGES.EXHAUSTED_TITLE,
      expect.stringContaining("Open de Lyon — Latines Adultes C"),
    );
  });

  it("ignores non-registration entries", () => {
    handleRegistrationReplayExhausted(
      { ...mutation("register"), kind: undefined },
      httpError(500),
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows the standalone alert when given up outside a replay run", () => {
    handleRegistrationReplayExhausted(
      mutation("register", named),
      httpError(503),
    );
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      QUEUE_MESSAGES.EXHAUSTED_TITLE,
      buildExhaustedAlert(mutation("register", named), httpError(503)).message,
    );
  });

  describe("inside a replay run", () => {
    afterEach(() => {
      // Never leak an open batch into the next test.
      endRegistrationReplayBatch();
    });

    it("joins the single recap of the run, with its reason and retry hint", () => {
      beginRegistrationReplayBatch();
      handleRegistrationReplaySuccess({
        ...mutation("register", {
          competitionTitle: "Coupe de Paris",
          eventLabel: "Standard Juniors B",
        }),
        id: "m2",
      });
      handleRegistrationReplayExhausted(
        mutation("register", named),
        networkError(),
      );
      // Nothing is shown while the run is in progress.
      expect(alertSpy).not.toHaveBeenCalled();

      endRegistrationReplayBatch();

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(
        QUEUE_MESSAGES.RECAP_TITLE,
        [
          "2 actions en attente ont été traitées (1 envoyée, 1 abandonnée) :",
          "• Coupe de Paris — Standard Juniors B : inscription envoyée",
          `• Open de Lyon — Latines Adultes C : inscription abandonnée. Motif : ${EXHAUSTED_REASONS.UNREACHABLE} malgré plusieurs tentatives`,
          QUEUE_MESSAGES.EXHAUSTED_RETRY_REGISTER,
        ].join("\n"),
      );
    });

    it("gives each retry hint once, for register and unregister", () => {
      beginRegistrationReplayBatch();
      handleRegistrationReplayExhausted(
        mutation("register", named),
        httpError(500),
      );
      handleRegistrationReplayExhausted(
        { ...mutation("register"), id: "m2" },
        httpError(429),
      );
      handleRegistrationReplayExhausted(
        { ...mutation("unregister", named), id: "m3" },
        httpError(502),
      );
      endRegistrationReplayBatch();

      expect(alertSpy).toHaveBeenCalledTimes(1);
      const message = alertSpy.mock.calls[0][1] as string;
      expect(message).toContain("(3 abandonnées) :");
      expect(message).toContain(
        `• ${QUEUE_MESSAGES.RECAP_UNNAMED_EVENT} : inscription abandonnée. Motif : ${EXHAUSTED_REASONS.OVERLOADED}`,
      );
      expect(
        message.split(QUEUE_MESSAGES.EXHAUSTED_RETRY_REGISTER),
      ).toHaveLength(2);
      expect(message).toContain(QUEUE_MESSAGES.EXHAUSTED_RETRY_UNREGISTER);
    });

    it("keeps the standalone alert when it is the only outcome of the run", () => {
      beginRegistrationReplayBatch();
      handleRegistrationReplayExhausted(
        mutation("unregister", named),
        httpError(500),
      );
      endRegistrationReplayBatch();
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(
        QUEUE_MESSAGES.EXHAUSTED_TITLE,
        buildExhaustedAlert(mutation("unregister", named), httpError(500))
          .message,
      );
    });
  });
});

describe("replay recap (#859)", () => {
  const named = (
    action: "register" | "unregister",
    id: string,
    competitionTitle: string,
    eventLabel: string,
  ): PendingMutation => ({
    ...mutation(action, { competitionTitle, eventLabel }),
    id,
  });

  afterEach(() => {
    // Never leak an open batch into the next test.
    endRegistrationReplayBatch();
  });

  it("names an event from its discipline, dance, age group and level", () => {
    expect(
      eventRecapLabel({
        category: "LATIN",
        dance: "Samba",
        ageGroup: "Adultes",
        level: "C",
      }),
    ).toBe("Latines Samba Adultes C");
    expect(eventRecapLabel({ category: "STANDARD", level: null })).toBe(
      "Standards",
    );
  });

  it("shows one recap for several replays, refusals with their reason", () => {
    beginRegistrationReplayBatch();
    handleRegistrationReplaySuccess(
      named("register", "m1", "Open de Lyon", "Latines Adultes C"),
    );
    handleRegistrationReplayError(
      named("register", "m2", "Coupe de Paris", "Standard Juniors B"),
      new RegistrationDeadlinePassedError(),
    );
    handleRegistrationReplayError(
      named("unregister", "m3", "Gala de Nice", "Standard Adultes A"),
      httpError(422, { message: "Désinscription impossible le jour J" }),
    );
    // Nothing is shown while the run is in progress.
    expect(alertSpy).not.toHaveBeenCalled();

    endRegistrationReplayBatch();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      QUEUE_MESSAGES.RECAP_TITLE,
      [
        "3 actions en attente ont été traitées (1 envoyée, 2 refusées) :",
        "• Open de Lyon — Latines Adultes C : inscription envoyée",
        `• Coupe de Paris — Standard Juniors B : inscription refusée. Motif : ${REFUSAL_REASONS.DEADLINE_PASSED}`,
        "• Gala de Nice — Standard Adultes A : désinscription refusée. Motif : Désinscription impossible le jour J",
      ].join("\n"),
    );
    // The side effects of a success still run.
    expect(cancelDeadlineNotificationForCompetition).toHaveBeenCalledWith("c1");
  });

  it("keeps the single alert unchanged when one registration was pending", () => {
    beginRegistrationReplayBatch();
    handleRegistrationReplaySuccess(
      named("register", "m1", "Open de Lyon", "Latines Adultes C"),
    );
    endRegistrationReplayBatch();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      QUEUE_MESSAGES.REPLAYED_TITLE,
      QUEUE_MESSAGES.REPLAYED_REGISTER,
    );

    alertSpy.mockClear();
    beginRegistrationReplayBatch();
    handleRegistrationReplayError(mutation("register"), httpError(409));
    endRegistrationReplayBatch();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      QUEUE_MESSAGES.REPLAY_REJECTED_TITLE,
      QUEUE_MESSAGES.ALREADY_REGISTERED,
    );
  });

  it("says nothing for a run without a final outcome (kept for later)", () => {
    beginRegistrationReplayBatch();
    expect(
      handleRegistrationReplayError(mutation("register"), networkError()),
    ).toBe("retry");
    endRegistrationReplayBatch();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("names entries queued before the names were stored", () => {
    const recap = buildReplayRecap([
      {
        action: "register",
        result: "sent",
        alert: { title: "t", message: "m" },
      },
      {
        action: "register",
        result: "refused",
        competitionTitle: "Open de Lyon",
        alert: { title: "t", message: "m" },
      },
    ]);
    expect(recap?.message).toBe(
      [
        "2 actions en attente ont été traitées (1 envoyée, 1 refusée) :",
        "• Épreuve : inscription envoyée",
        "• Open de Lyon : inscription refusée",
      ].join("\n"),
    );
  });

  it("counts several successes in the plural", () => {
    const sent = {
      action: "register" as const,
      result: "sent" as const,
      alert: { title: "t", message: "m" },
    };
    expect(buildReplayRecap([sent, sent])?.message).toContain("(2 envoyées) :");
    expect(buildReplayRecap([])).toBeNull();
  });
});
