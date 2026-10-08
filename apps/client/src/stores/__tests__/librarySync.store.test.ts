import {
  isLibraryStale,
  LIBRARY_MAX_AGE_MS,
  markLibraryStale,
  useLibrarySyncStore,
} from "../librarySync.store";

describe("librarySync store", () => {
  beforeEach(() => {
    useLibrarySyncStore.setState({ version: 0, loadedVersion: 0, loadedAt: 0 });
  });

  it("markLibraryStale incrémente la version", () => {
    markLibraryStale();
    markLibraryStale();
    expect(useLibrarySyncStore.getState().version).toBe(2);
  });

  it("markLoaded enregistre la version chargée et l'horodatage", () => {
    useLibrarySyncStore.getState().markLoaded(3, 1000);
    expect(useLibrarySyncStore.getState()).toMatchObject({
      loadedVersion: 3,
      loadedAt: 1000,
    });
  });

  it("un chargement plus ancien ne fait pas reculer la version chargée", () => {
    useLibrarySyncStore.getState().markLoaded(3, 1000);
    useLibrarySyncStore.getState().markLoaded(2, 2000);
    expect(useLibrarySyncStore.getState().loadedVersion).toBe(3);
  });

  describe("isLibraryStale", () => {
    const now = 10_000_000;

    it("jamais chargée → false (le premier chargement a sa propre règle)", () => {
      expect(
        isLibraryStale({ version: 5, loadedVersion: 0, loadedAt: 0 }, now),
      ).toBe(false);
    });

    it("à jour et récente → false", () => {
      expect(
        isLibraryStale({ version: 1, loadedVersion: 1, loadedAt: now }, now),
      ).toBe(false);
    });

    it("piste modifiée depuis le chargement → true", () => {
      expect(
        isLibraryStale({ version: 2, loadedVersion: 1, loadedAt: now }, now),
      ).toBe(true);
    });

    it("plus vieille que LIBRARY_MAX_AGE_MS → true", () => {
      expect(
        isLibraryStale(
          {
            version: 1,
            loadedVersion: 1,
            loadedAt: now - LIBRARY_MAX_AGE_MS - 1,
          },
          now,
        ),
      ).toBe(true);
    });
  });
});
