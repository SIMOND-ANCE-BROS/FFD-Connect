import { NotificationApi } from "../../services/api/notification-api";
import { useNotificationPreferencesStore } from "../notificationPreferences.store";

jest.mock("../../services/api/notification-api", () => ({
  NotificationApi: {
    getPreferences: jest.fn(),
    updatePreference: jest.fn(),
  },
}));

const api = NotificationApi as jest.Mocked<typeof NotificationApi>;

const catalogue = [
  {
    type: "registration_validated",
    label: "Inscription validée",
    description: "Quand votre club valide une inscription.",
    enabled: true,
  },
  {
    type: "results_published",
    label: "Résultats publiés",
    description: "Quand les résultats d'une compétition sortent.",
    enabled: false,
  },
];

describe("notificationPreferences.store", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNotificationPreferencesStore.getState().reset();
  });

  it("loads the catalogue served by the backend", async () => {
    api.getPreferences.mockResolvedValue(catalogue);

    await useNotificationPreferencesStore.getState().load();

    expect(useNotificationPreferencesStore.getState().preferences).toEqual(
      catalogue,
    );
    expect(useNotificationPreferencesStore.getState().loading).toBe(false);
    expect(useNotificationPreferencesStore.getState().error).toBeNull();
  });

  it("surfaces a message instead of throwing when the load fails", async () => {
    api.getPreferences.mockRejectedValue(new Error("offline"));

    await useNotificationPreferencesStore.getState().load();

    expect(useNotificationPreferencesStore.getState().preferences).toEqual([]);
    expect(useNotificationPreferencesStore.getState().loading).toBe(false);
    expect(useNotificationPreferencesStore.getState().error).not.toBeNull();
  });

  it("flips the switch before the request resolves", async () => {
    api.getPreferences.mockResolvedValue(catalogue);
    await useNotificationPreferencesStore.getState().load();

    let release: (() => void) | undefined;
    api.updatePreference.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const pendingCall = useNotificationPreferencesStore
      .getState()
      .setPreference("registration_validated", false);

    // L'intérêt de la bascule optimiste est là : l'état est déjà à jour alors
    // que la requête n'a pas répondu.
    const state = useNotificationPreferencesStore.getState();
    expect(
      state.preferences.find((p) => p.type === "registration_validated")
        ?.enabled,
    ).toBe(false);
    expect(state.pending).toContain("registration_validated");

    release?.();
    await pendingCall;

    expect(useNotificationPreferencesStore.getState().pending).toEqual([]);
  });

  it("rolls the switch back when the request fails", async () => {
    api.getPreferences.mockResolvedValue(catalogue);
    await useNotificationPreferencesStore.getState().load();
    api.updatePreference.mockRejectedValue(new Error("500"));

    await useNotificationPreferencesStore
      .getState()
      .setPreference("registration_validated", false);

    const state = useNotificationPreferencesStore.getState();
    expect(
      state.preferences.find((p) => p.type === "registration_validated")
        ?.enabled,
    ).toBe(true);
    expect(state.error).not.toBeNull();
    expect(state.pending).toEqual([]);
  });

  it("a failed toggle does not revert a different one that succeeded meanwhile", async () => {
    api.getPreferences.mockResolvedValue(catalogue);
    await useNotificationPreferencesStore.getState().load();

    // Le premier échoue, le second réussit. Un rollback naïf par inversion
    // écraserait le second ; on restaure uniquement le type concerné.
    api.updatePreference.mockImplementation((type: string) =>
      type === "registration_validated"
        ? Promise.reject(new Error("500"))
        : Promise.resolve(undefined),
    );

    await Promise.all([
      useNotificationPreferencesStore
        .getState()
        .setPreference("registration_validated", false),
      useNotificationPreferencesStore
        .getState()
        .setPreference("results_published", true),
    ]);

    const prefs = useNotificationPreferencesStore.getState().preferences;
    expect(
      prefs.find((p) => p.type === "registration_validated")?.enabled,
    ).toBe(true);
    expect(prefs.find((p) => p.type === "results_published")?.enabled).toBe(
      true,
    );
  });
});
