import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  QUERY_CACHE_KEY,
  clearQueryCache,
  queryClient,
  shouldPersistQuery,
} from "../queryClient";
import { runSessionEndCleanups } from "../sessionCleanup";

const seed = async (queryKey: readonly unknown[]) => {
  await queryClient.prefetchQuery({ queryKey, queryFn: () => ({ ok: true }) });
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query) throw new Error("query not seeded");
  return query;
};

describe("queryClient — persistance et déconnexion", () => {
  afterEach(() => queryClient.clear());

  it("ne persiste jamais les propositions de correction", async () => {
    expect(shouldPersistQuery(await seed(["track-corrections", "mine"]))).toBe(
      false,
    );
    expect(
      shouldPersistQuery(await seed(["track-corrections", "admin", "PENDING"])),
    ).toBe(false);
  });

  it("persiste les autres requêtes réussies (comportement par défaut)", async () => {
    expect(shouldPersistQuery(await seed(["notifications"]))).toBe(true);
  });

  it("vide le cache mémoire et la copie persistée", async () => {
    await seed(["notifications"]);
    await clearQueryCache();

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(QUERY_CACHE_KEY);
  });

  it("est branché sur la fin de session (déconnexion)", async () => {
    await seed(["track-corrections", "mine"]);
    (AsyncStorage.removeItem as jest.Mock).mockClear();

    await runSessionEndCleanups();

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(QUERY_CACHE_KEY);
  });
});
