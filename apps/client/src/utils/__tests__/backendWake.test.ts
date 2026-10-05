/**
 * Tests du wrapper global de fetch qui réveille le Container App backend quand
 * il est endormi (scale-to-zero), et du pré-réveil silencieux au lancement.
 * On mocke `../../config` pour fournir des URLs de wake/health et on pilote un
 * faux `global.fetch`.
 */

const CONFIG = {
  WAKE_ENABLED: true,
  WAKE_URL: "https://wake.example/api/wake",
  WAKE_KEY: "test-key",
  HEALTH_URL: "https://api.example/health",
  STATIC_BASE_URL: "https://api.example",
};

/** Config d'un build dev : réveil désactivé. */
const CONFIG_DISABLED = {
  WAKE_ENABLED: false,
  WAKE_URL: "",
  WAKE_KEY: "",
  HEALTH_URL: "",
  STATIC_BASE_URL: "https://api.example",
};

interface FakeRes {
  status: number;
  ok: boolean;
}

interface NetState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

const ONLINE: NetState = { isConnected: true, isInternetReachable: true };

function loadModule(
  config: typeof CONFIG | Record<string, unknown>,
  netState: { current: NetState } = { current: ONLINE },
) {
  jest.resetModules();
  jest.doMock("../../config", () => config);
  // NetInfo reads `netState.current` on every fetch so a test can flip the
  // connectivity between calls (offline → online transitions).
  jest.doMock("@react-native-community/netinfo", () => ({
    __esModule: true,
    default: {
      fetch: jest.fn(async () => netState.current),
      addEventListener: jest.fn(() => jest.fn()),
    },
  }));
  jest.doMock("../logger", () => ({
    createLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }));

  const mod = require("../backendWake") as typeof import("../backendWake");
  // Même registre de modules que backendWake : c'est l'instance de store que
  // le wrapper manipule réellement.
  const { useWakeStore } =
    require("../../stores/wake.store") as typeof import("../../stores/wake.store");
  return { ...mod, useWakeStore };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("backendWake", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    (
      globalThis as unknown as { __ffdWakeInstalled?: boolean }
    ).__ffdWakeInstalled = false;
    jest.resetModules();
  });

  it("no-ops when wake is disabled (dev builds)", () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;
    const { installBackendWake } = loadModule(CONFIG_DISABLED);
    installBackendWake();
    expect(global.fetch).toBe(mockFetch);
  });

  it("passes non-backend requests straight through", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 200, ok: true });
    global.fetch = mockFetch;
    const { installBackendWake } = loadModule(CONFIG);
    installBackendWake();
    await global.fetch("https://other.com/x");
    expect(mockFetch).toHaveBeenCalledWith("https://other.com/x", undefined);
  });

  it("on 502 it wakes, polls health, then replays the request", async () => {
    let dataCalls = 0;
    const mockFetch = jest.fn(async (url: string) => {
      if (url === "https://api.example/data") {
        dataCalls += 1;
        return dataCalls === 1
          ? { status: 502, ok: false }
          : { status: 200, ok: true };
      }
      if (url.startsWith(CONFIG.WAKE_URL)) {
        return { status: 202, ok: true };
      }
      if (url === CONFIG.HEALTH_URL) {
        return { status: 200, ok: true };
      }
      return { status: 200, ok: true };
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { installBackendWake, useWakeStore } = loadModule(CONFIG);
    installBackendWake();

    const res = (await global.fetch(
      "https://api.example/data",
    )) as unknown as FakeRes;

    expect(res.status).toBe(200);
    expect(dataCalls).toBe(2); // original + replay
    // Un réveil déclenché par une requête utilisateur affiche l'overlay.
    expect(useWakeStore.getState().visible).toBe(false); // reset en fin de réveil
    // wake endpoint hit with the shared key header
    const wakeCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).startsWith(CONFIG.WAKE_URL),
    );
    expect(wakeCall).toBeDefined();
    expect(wakeCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "X-Wake-Key": "test-key" },
    });
  });

  it("on a network error it wakes and replays", async () => {
    let dataCalls = 0;
    const mockFetch = jest.fn(async (url: string) => {
      if (url === "https://api.example/data") {
        dataCalls += 1;
        if (dataCalls === 1) throw new Error("Network request failed");
        return { status: 200, ok: true };
      }
      if (url.startsWith(CONFIG.WAKE_URL)) return { status: 202, ok: true };
      if (url === CONFIG.HEALTH_URL) return { status: 200, ok: true };
      return { status: 200, ok: true };
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { installBackendWake } = loadModule(CONFIG);
    installBackendWake();

    const res = (await global.fetch(
      "https://api.example/data",
    )) as unknown as FakeRes;

    expect(res.status).toBe(200);
    expect(dataCalls).toBe(2);
  });

  it("is idempotent: installing twice keeps a single wrapper", () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 200, ok: true });
    global.fetch = mockFetch;
    const { installBackendWake } = loadModule(CONFIG);
    installBackendWake();
    const wrapped = global.fetch;
    installBackendWake();
    expect(global.fetch).toBe(wrapped);
  });

  it("warmBackend no-ops when wake is disabled (dev builds)", async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;
    const { warmBackend } = loadModule(CONFIG_DISABLED);
    await warmBackend();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("wakes without WAKE_URL (Container Apps: polling is the wake)", async () => {
    let dataCalls = 0;
    const mockFetch = jest.fn(async (url: string) => {
      if (url === "https://api.example/data") {
        dataCalls += 1;
        return dataCalls === 1
          ? { status: 502, ok: false }
          : { status: 200, ok: true };
      }
      if (url === CONFIG.HEALTH_URL) return { status: 200, ok: true };
      return { status: 200, ok: true };
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { installBackendWake } = loadModule({
      ...CONFIG,
      WAKE_URL: "",
      WAKE_KEY: "",
    });
    installBackendWake();

    const res = (await global.fetch(
      "https://api.example/data",
    )) as unknown as FakeRes;

    expect(res.status).toBe(200);
    expect(dataCalls).toBe(2); // original + replay
    // Aucun POST de réveil : le polling /health a suffi.
    expect(
      mockFetch.mock.calls.some(
        (c) => (c[1] as { method?: string } | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });

  it("wakeBackend resolves false when wake is disabled", async () => {
    global.fetch = jest.fn();
    const { wakeBackend, useWakeStore } = loadModule(CONFIG_DISABLED);
    await expect(wakeBackend()).resolves.toBe(false);
    expect(useWakeStore.getState().waking).toBe(false);
  });

  it("wakeBackend shows the overlay and resolves true once healthy", async () => {
    const mockFetch = jest.fn(async (url: string) => {
      if (url.startsWith(CONFIG.WAKE_URL)) return { status: 202, ok: true };
      if (url === CONFIG.HEALTH_URL) return { status: 200, ok: true };
      return { status: 200, ok: true };
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { wakeBackend, useWakeStore } = loadModule(CONFIG);
    const visibleStates: boolean[] = [];
    const unsubscribe = useWakeStore.subscribe((s) => {
      visibleStates.push(s.visible);
    });

    await expect(wakeBackend()).resolves.toBe(true);
    unsubscribe();

    // Réveil non-silencieux : l'overlay est passé visible pendant l'attente.
    expect(visibleStates.some((v) => v)).toBe(true);
    expect(useWakeStore.getState().waking).toBe(false);
  });

  it("warmBackend leaves a warm backend alone", async () => {
    const mockFetch = jest.fn(async (url: string) => {
      if (url === CONFIG.HEALTH_URL) return { status: 200, ok: true };
      return { status: 200, ok: true };
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { warmBackend, useWakeStore } = loadModule(CONFIG);
    await warmBackend();

    // Sonde /health uniquement — aucun POST de réveil, aucun overlay.
    expect(
      mockFetch.mock.calls.some((c) =>
        String(c[0]).startsWith(CONFIG.WAKE_URL),
      ),
    ).toBe(false);
    expect(useWakeStore.getState().waking).toBe(false);
  });

  it("warmBackend wakes a sleeping backend without showing the overlay", async () => {
    const mockFetch = jest.fn(
      async (url: string, init?: { signal?: unknown }) => {
        // La sonde initiale (porteuse d'un signal d'abort) échoue : endormi.
        if (url === CONFIG.HEALTH_URL && init?.signal) {
          throw new Error("Network request failed");
        }
        if (url.startsWith(CONFIG.WAKE_URL)) return { status: 202, ok: true };
        if (url === CONFIG.HEALTH_URL) return { status: 200, ok: true };
        return { status: 200, ok: true };
      },
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const { warmBackend, useWakeStore } = loadModule(CONFIG);
    const visibleStates: boolean[] = [];
    const unsubscribe = useWakeStore.subscribe((s) => {
      visibleStates.push(s.visible);
    });

    await warmBackend();
    unsubscribe();

    // Le réveil a bien été demandé…
    expect(
      mockFetch.mock.calls.some((c) =>
        String(c[0]).startsWith(CONFIG.WAKE_URL),
      ),
    ).toBe(true);
    // …mais l'overlay n'est jamais apparu (réveil silencieux).
    expect(visibleStates.every((v) => v === false)).toBe(true);
    expect(useWakeStore.getState().waking).toBe(false);
  });

  it("warmBackend joins an in-flight wake instead of starting a second one", async () => {
    let releaseHealthPoll: (() => void) | null = null;
    const healthPollHeld = new Promise<FakeRes>((resolve) => {
      releaseHealthPoll = () => resolve({ status: 200, ok: true });
    });

    const mockFetch = jest.fn(
      async (url: string, init?: { signal?: unknown }) => {
        if (url === CONFIG.HEALTH_URL && init?.signal) {
          throw new Error("Network request failed"); // sonde initiale : endormi
        }
        if (url.startsWith(CONFIG.WAKE_URL)) return { status: 202, ok: true };
        if (url === CONFIG.HEALTH_URL) return healthPollHeld; // poll retenu
        return { status: 200, ok: true };
      },
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const { warmBackend, useWakeStore } = loadModule(CONFIG);

    const first = warmBackend(); // démarre le réveil silencieux…
    await flush();
    expect(useWakeStore.getState().waking).toBe(true);

    const second = warmBackend(); // …le second appel rejoint le même réveil
    await flush();

    // Une seule sonde initiale et un seul POST de réveil : pas de doublon.
    expect(
      mockFetch.mock.calls.filter(
        (c) => c[0] === CONFIG.HEALTH_URL && c[1]?.signal,
      ).length,
    ).toBe(1);
    expect(
      mockFetch.mock.calls.filter((c) =>
        String(c[0]).startsWith(CONFIG.WAKE_URL),
      ).length,
    ).toBe(1);

    releaseHealthPoll?.();
    await Promise.all([first, second]);
    expect(useWakeStore.getState().waking).toBe(false);
  });

  it("a user request failing mid-silent-wake reveals the overlay and replays", async () => {
    let releaseHealthPoll: (() => void) | null = null;
    const healthPollHeld = new Promise<FakeRes>((resolve) => {
      releaseHealthPoll = () => resolve({ status: 200, ok: true });
    });

    let dataCalls = 0;
    const mockFetch = jest.fn(
      async (url: string, init?: { signal?: unknown }) => {
        if (url === "https://api.example/data") {
          dataCalls += 1;
          return dataCalls === 1
            ? { status: 503, ok: false }
            : { status: 200, ok: true };
        }
        if (url === CONFIG.HEALTH_URL && init?.signal) {
          throw new Error("Network request failed"); // sonde initiale : endormi
        }
        if (url.startsWith(CONFIG.WAKE_URL)) return { status: 202, ok: true };
        if (url === CONFIG.HEALTH_URL) return healthPollHeld; // poll retenu
        return { status: 200, ok: true };
      },
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const { installBackendWake, warmBackend, useWakeStore } =
      loadModule(CONFIG);
    installBackendWake();

    const warming = warmBackend(); // réveil silencieux en cours…
    await flush();
    expect(useWakeStore.getState().waking).toBe(true);
    expect(useWakeStore.getState().visible).toBe(false);

    // …quand une requête utilisateur échoue : elle rejoint le même réveil et
    // rend l'overlay visible.
    const pendingRequest = global.fetch("https://api.example/data");
    await flush();
    expect(useWakeStore.getState().visible).toBe(true);

    releaseHealthPoll?.();
    const res = (await pendingRequest) as unknown as FakeRes;
    await warming;

    expect(res.status).toBe(200);
    expect(dataCalls).toBe(2); // original + replay après réveil
    expect(useWakeStore.getState().waking).toBe(false);
  });

  describe("when the device is offline", () => {
    const OFFLINE: NetState = {
      isConnected: false,
      isInternetReachable: false,
    };

    /** fetch that fails like a device without network. */
    function offlineFetch() {
      return jest.fn(async () => {
        throw new Error("Network request failed");
      });
    }

    function isInfraCall(c: unknown[]): boolean {
      const url = String(c[0]);
      return url.startsWith(CONFIG.WAKE_URL) || url === CONFIG.HEALTH_URL;
    }

    it.each<[string, NetState]>([
      ["no connection", OFFLINE],
      [
        "captive portal (connected, internet unreachable)",
        { isConnected: true, isInternetReachable: false },
      ],
      [
        "no connection, reachability unknown",
        { isConnected: false, isInternetReachable: null },
      ],
    ])(
      "fails fast with the original network error and no overlay (%s)",
      async (_label, state) => {
        const mockFetch = offlineFetch();
        global.fetch = mockFetch;
        const { installBackendWake, useWakeStore } = loadModule(CONFIG, {
          current: state,
        });
        installBackendWake();
        const visibleStates: boolean[] = [];
        const unsubscribe = useWakeStore.subscribe((s) => {
          visibleStates.push(s.visible);
        });

        await expect(global.fetch("https://api.example/data")).rejects.toThrow(
          "Network request failed",
        );
        unsubscribe();

        // Single attempt, no wake POST, no /health polling, no overlay.
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch.mock.calls.some(isInfraCall)).toBe(false);
        expect(visibleStates.every((v) => v === false)).toBe(true);
        expect(useWakeStore.getState().waking).toBe(false);
      },
    );

    it("wakeBackend resolves false without waking (axios path)", async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
      const { wakeBackend, useWakeStore } = loadModule(CONFIG, {
        current: OFFLINE,
      });

      await expect(wakeBackend()).resolves.toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(useWakeStore.getState().waking).toBe(false);
      expect(useWakeStore.getState().visible).toBe(false);
    });

    it("warmBackend skips both the probe and the wake", async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
      const { warmBackend, useWakeStore } = loadModule(CONFIG, {
        current: OFFLINE,
      });

      await warmBackend();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(useWakeStore.getState().waking).toBe(false);
    });

    it("coming back online does not trigger a spurious wake", async () => {
      const net = { current: OFFLINE };
      let online = false;
      const mockFetch = jest.fn(async () => {
        if (!online) throw new Error("Network request failed");
        return { status: 200, ok: true };
      });
      global.fetch = mockFetch as unknown as typeof fetch;
      const { installBackendWake, warmBackend, useWakeStore } = loadModule(
        CONFIG,
        net,
      );
      installBackendWake();

      await warmBackend();
      await expect(global.fetch("https://api.example/data")).rejects.toThrow();

      // Network is back: nothing fires on its own (no polling, no retry)…
      net.current = ONLINE;
      online = true;
      await flush();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // …and the next real request goes straight through without a wake.
      const res = (await global.fetch(
        "https://api.example/data",
      )) as unknown as FakeRes;
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls.some(isInfraCall)).toBe(false);
      expect(useWakeStore.getState().waking).toBe(false);
    });
  });

  it("keeps waking when reachability is unknown (optimistic)", async () => {
    let dataCalls = 0;
    const mockFetch = jest.fn(async (url: string) => {
      if (url === "https://api.example/data") {
        dataCalls += 1;
        if (dataCalls === 1) throw new Error("Network request failed");
        return { status: 200, ok: true };
      }
      return { status: 200, ok: true }; // wake + /health
    });
    global.fetch = mockFetch as unknown as typeof fetch;
    const { installBackendWake } = loadModule(CONFIG, {
      current: { isConnected: true, isInternetReachable: null },
    });
    installBackendWake();

    const res = (await global.fetch(
      "https://api.example/data",
    )) as unknown as FakeRes;
    expect(res.status).toBe(200);
    expect(dataCalls).toBe(2); // woke and replayed, as before
    expect(
      mockFetch.mock.calls.some((c) => String(c[0]) === CONFIG.HEALTH_URL),
    ).toBe(true);
  });

  describe("background launch (#775)", () => {
    /** AppState must be read from the registry loadModule() just reset. */
    const setAppState = (value: string) => {
      const rn = require("react-native") as {
        AppState: { currentState: string };
      };
      const previous = rn.AppState.currentState;
      rn.AppState.currentState = value;
      return () => {
        rn.AppState.currentState = previous;
      };
    };

    it("skips the pre-warm when the app was launched in the background", async () => {
      // A data-only push loads the JS bundle without the user looking at the
      // phone. Pre-warming there wakes a scale-to-zero app for nothing.
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
      const mod = loadModule(CONFIG);
      const restore = setAppState("background");

      await mod.warmBackend();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mod.useWakeStore.getState().waking).toBe(false);
      restore();
    });

    it("still pre-warms when AppState is not yet settled at launch", async () => {
      // On a normal cold launch AppState can be "inactive" or unknown at
      // module time — losing the pre-warm there would be a regression.
      const mockFetch = jest.fn(async () => ({ ok: true }) as FakeRes);
      global.fetch = mockFetch as unknown as typeof fetch;
      const mod = loadModule(CONFIG);
      const restore = setAppState("inactive");

      await mod.warmBackend();

      expect(mockFetch).toHaveBeenCalled();
      restore();
    });
  });
});
