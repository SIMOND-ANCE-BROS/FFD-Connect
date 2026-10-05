import AsyncStorage from "@react-native-async-storage/async-storage";
import { useOfflineQueueStore } from "../../stores/offlineQueue.store";
import {
  OFFLINE_QUEUE_KEY,
  clearOfflineQueue,
  enqueueMutation,
  hydrateOfflineQueueStore,
  loadQueue,
  markInFlight,
  removeMutations,
  type EnqueueInput,
} from "../offlineQueueStorage";

const register: EnqueueInput = {
  endpoint: "POST /competitions/c1/register",
  payload: { eventId: "e1" },
  queryKeysToInvalidate: [["myRegistrations"]],
  collapseKey: "registration:c1:e1",
};
const unregister: EnqueueInput = {
  ...register,
  endpoint: "POST /competitions/c1/unregister",
};

beforeEach(async () => {
  await AsyncStorage.clear();
  useOfflineQueueStore.getState().setItems([]);
});

describe("offlineQueueStorage", () => {
  it("persists an entry and mirrors it in the store", async () => {
    await expect(enqueueMutation(register)).resolves.toBe("enqueued");
    const queue = await loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      endpoint: register.endpoint,
      collapseKey: "registration:c1:e1",
    });
    expect(queue[0].id).toEqual(expect.any(String));
    expect(useOfflineQueueStore.getState().items).toEqual(queue);
  });

  it("never enqueues the same action twice", async () => {
    await enqueueMutation(register);
    await expect(enqueueMutation(register)).resolves.toBe("duplicate");
    expect(await loadQueue()).toHaveLength(1);
  });

  it("collapses register + unregister on the same target into a no-op", async () => {
    await enqueueMutation(register);
    await expect(enqueueMutation(unregister)).resolves.toBe("collapsed");
    expect(await loadQueue()).toHaveLength(0);
    expect(useOfflineQueueStore.getState().items).toHaveLength(0);
    // ...and the user can queue the action again afterwards.
    await expect(enqueueMutation(register)).resolves.toBe("enqueued");
  });

  it("does not collapse entries of different targets", async () => {
    await enqueueMutation(register);
    await expect(
      enqueueMutation({ ...unregister, collapseKey: "registration:c1:e2" }),
    ).resolves.toBe("enqueued");
    expect(await loadQueue()).toHaveLength(2);
  });

  it("appends instead of collapsing an entry being replayed", async () => {
    await enqueueMutation(register);
    const [inFlight] = await loadQueue();
    markInFlight([inFlight.id], true);
    await expect(enqueueMutation(unregister)).resolves.toBe("enqueued");
    expect((await loadQueue()).map((m) => m.endpoint)).toEqual([
      register.endpoint,
      unregister.endpoint,
    ]);
    markInFlight([inFlight.id], false);
  });

  it("treats the last entry of a target as the pending intent", async () => {
    await enqueueMutation(register);
    const [inFlight] = await loadQueue();
    markInFlight([inFlight.id], true);
    await enqueueMutation(unregister);
    // register (in flight) → unregister (queued) → register cancels the unregister
    await expect(enqueueMutation(register)).resolves.toBe("collapsed");
    expect(await loadQueue()).toHaveLength(1);
    markInFlight([inFlight.id], false);
  });

  it("enqueues entries without a collapse key unconditionally", async () => {
    const plain = { ...register, collapseKey: undefined };
    await enqueueMutation(plain);
    await expect(enqueueMutation(plain)).resolves.toBe("enqueued");
    expect(await loadQueue()).toHaveLength(2);
  });

  it("removes settled entries while keeping ones enqueued meanwhile", async () => {
    await enqueueMutation(register);
    const [first] = await loadQueue();
    await enqueueMutation({ ...register, collapseKey: "registration:c1:e9" });
    await removeMutations([first.id]);
    const queue = await loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].collapseKey).toBe("registration:c1:e9");
  });

  it("removeMutations([]) is a no-op", async () => {
    await enqueueMutation(register);
    await removeMutations([]);
    expect(await loadQueue()).toHaveLength(1);
  });

  it("survives an app restart: the persisted queue hydrates the store", async () => {
    await enqueueMutation(register);
    // Simulated restart: in-memory store is empty, AsyncStorage is not.
    useOfflineQueueStore.getState().setItems([]);
    const queue = await hydrateOfflineQueueStore();
    expect(queue).toHaveLength(1);
    expect(useOfflineQueueStore.getState().items).toHaveLength(1);
  });

  it("reads corrupt or non-array JSON as an empty queue", async () => {
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, "{oops");
    expect(await loadQueue()).toEqual([]);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, '{"a":1}');
    expect(await loadQueue()).toEqual([]);
  });

  it("clearOfflineQueue wipes storage and store (logout)", async () => {
    await enqueueMutation(register);
    await clearOfflineQueue();
    expect(await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)).toBeNull();
    expect(useOfflineQueueStore.getState().items).toEqual([]);
  });

  it("serializes concurrent writers without losing entries", async () => {
    await Promise.all([
      enqueueMutation({ ...register, collapseKey: "k1" }),
      enqueueMutation({ ...register, collapseKey: "k2" }),
      enqueueMutation({ ...register, collapseKey: "k3" }),
    ]);
    expect(await loadQueue()).toHaveLength(3);
  });
});
