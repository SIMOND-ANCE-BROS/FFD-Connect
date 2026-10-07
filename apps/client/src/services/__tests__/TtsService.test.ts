jest.mock("../../config", () => ({ BACKEND_URL: "http://test/api/v1" }));
jest.mock("../../utils/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

import { createAudioPlayer } from "expo-audio";
import { getInfoAsync, writeAsStringAsync } from "expo-file-system/legacy";
import TtsService, {
  arrayBufferToBase64,
  ttsCacheFilename,
} from "../TtsService";

type StatusListener = (status: Record<string, unknown>) => void;

// One fake announcement player shared by the module singleton.
const listeners = new Set<StatusListener>();
const fakeAnnouncer = {
  play: jest.fn(),
  pause: jest.fn(),
  replace: jest.fn(),
  volume: 0.3,
  loop: true,
  addListener: jest.fn((_event: string, l: StatusListener) => {
    listeners.add(l);
    return { remove: () => listeners.delete(l) };
  }),
};
const emitStatus = (status: Record<string, unknown>) =>
  [...listeners].forEach((l) => l(status));
(createAudioPlayer as jest.Mock).mockImplementation(() => fakeAnnouncer);

const toBuffer = (s: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(s);
  return bytes.buffer.slice(0, bytes.length);
};

describe("arrayBufferToBase64", () => {
  // Oracle = Node's Buffer base64 (the encoding expo-file-system expects).
  it.each(["", "M", "Ma", "Man", "hello", "any carnal pleasure."])(
    "matches Buffer base64 for %p",
    (s) => {
      expect(arrayBufferToBase64(toBuffer(s))).toBe(
        Buffer.from(s, "utf8").toString("base64"),
      );
    },
  );

  it("handles raw binary bytes with padding", () => {
    const bytes = new Uint8Array([0, 255, 16, 128, 1, 2]);
    expect(arrayBufferToBase64(bytes.buffer)).toBe(
      Buffer.from(bytes).toString("base64"),
    );
  });

  it("returns empty string for an empty buffer", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });
});

describe("TtsService API surface", () => {
  it("reports init status success", () => {
    expect(TtsService.getInitStatus()).toBe("success");
  });

  it("exposes at least one voice", () => {
    expect(TtsService.voices().length).toBeGreaterThan(0);
  });

  it("no-op setters resolve without throwing", async () => {
    await expect(TtsService.setDefaultVoice("v")).resolves.toBeUndefined();
    await expect(TtsService.setDefaultRate(1)).resolves.toBeUndefined();
    await expect(TtsService.setDefaultPitch(1)).resolves.toBeUndefined();
    await expect(TtsService.setDucking(true)).resolves.toBeUndefined();
    await expect(
      TtsService.setIgnoreSilentSwitch(true),
    ).resolves.toBeUndefined();
  });
});

describe("ttsCacheFilename", () => {
  it("does not collide for two long texts sharing a 50-char prefix", () => {
    const prefix = "Mesdames et messieurs, place au premier tour… on c";
    expect(prefix.length).toBe(50);
    const a = `${prefix}ommence avec la Samba, premier passage !`;
    const b = `${prefix}ommence avec la Rumba, premier passage !`;
    expect(ttsCacheFilename(a)).not.toBe(ttsCacheFilename(b));
  });

  it("does not collapse accents (deuxième vs deuxieme)", () => {
    expect(ttsCacheFilename("Samba, deuxième passage !")).not.toBe(
      ttsCacheFilename("Samba, deuxieme passage !"),
    );
  });

  it("is stable and versioned", () => {
    const name = ttsCacheFilename("Place au Tango !");
    expect(name).toBe(ttsCacheFilename("Place au Tango !"));
    expect(name).toMatch(/^tts_v2_[0-9a-f]{8}_[0-9a-z]+\.mp3$/);
  });
});

describe("TtsService.preload", () => {
  it("returns the cached file without hitting the network", async () => {
    (getInfoAsync as jest.Mock).mockResolvedValueOnce({
      exists: true,
      size: 2048,
    });
    const fetchSpy = jest.spyOn(global, "fetch");
    const path = await TtsService.preload("Place au Tango !");
    expect(path).toContain(ttsCacheFilename("Place au Tango !"));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("TtsService.preload (download)", () => {
  const okResponse = (bytes = 4) => ({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).fill(7).buffer),
  });
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    fetchMock = jest.spyOn(global, "fetch");
  });
  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  it("retries once after a failure", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce(okResponse());
    await expect(TtsService.preload("Place au Tango !")).resolves.toContain(
      ttsCacheFilename("Place au Tango !"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writeAsStringAsync).toHaveBeenCalledTimes(1);
  });

  it("gives up after two attempts with a TTS error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(TtsService.preload("Jive !")).rejects.toThrow(
      "TTS indisponible (TTS API Error: 503)",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches an empty audio body", async () => {
    fetchMock.mockResolvedValue(okResponse(0));
    await expect(TtsService.preload("Rumba !")).rejects.toThrow(/audio vide/);
    expect(writeAsStringAsync).not.toHaveBeenCalled();
  });

  it("does not trust an empty cached file", async () => {
    (getInfoAsync as jest.Mock).mockResolvedValueOnce({
      exists: true,
      size: 0,
    });
    fetchMock.mockResolvedValueOnce(okResponse());
    await TtsService.preload("Samba !");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the abort timeout running until the body is read", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        // Headers arrived, body stalls until the request is aborted.
        arrayBuffer: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      } as never),
    );
    const p = TtsService.preload("Quickstep !");
    const assertion = expect(p).rejects.toThrow(/Timeout/);
    await jest.advanceTimersByTimeAsync(30000);
    await jest.advanceTimersByTimeAsync(30000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("TtsService.speak (dedicated announcement player)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    listeners.clear();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const flush = () => Promise.resolve().then(() => Promise.resolve());

  it("plays at full volume, no loop, from a file uri", async () => {
    const p = TtsService.speak("Place au Tango !", "/cache/tts.mp3");
    await flush();
    expect(fakeAnnouncer.volume).toBe(1);
    expect(fakeAnnouncer.loop).toBe(false);
    expect(fakeAnnouncer.replace).toHaveBeenCalledWith({
      uri: "file:///cache/tts.mp3",
    });
    expect(fakeAnnouncer.play).toHaveBeenCalled();
    emitStatus({ didJustFinish: true });
    await expect(p).resolves.toBeUndefined();
  });

  it("does NOT resolve on the initial Paused status emitted after load", async () => {
    let resolved = false;
    const p = TtsService.speak("Samba, deuxième passage !", "file:///c/a.mp3");
    p.then(() => {
      resolved = true;
    }).catch(() => {});
    await flush();
    // replace() loads the file → "loaded but not playing" status
    emitStatus({
      isLoaded: true,
      playing: false,
      duration: 3,
      currentTime: 0,
      didJustFinish: false,
    });
    emitStatus({ isLoaded: true, playing: true, duration: 3, currentTime: 1 });
    await flush();
    expect(resolved).toBe(false);

    emitStatus({ isLoaded: true, playing: false, didJustFinish: true });
    await p;
    expect(resolved).toBe(true);
  });

  it("falls back to a safety timeout of clip duration + margin", async () => {
    let resolved = false;
    const p = TtsService.speak("Dernière danse : le Jive !", "file:///c/b.mp3");
    p.then(() => {
      resolved = true;
    }).catch(() => {});
    await flush();
    emitStatus({ isLoaded: true, playing: true, duration: 2, currentTime: 0 });
    jest.advanceTimersByTime(2000);
    await flush();
    expect(resolved).toBe(false);
    jest.advanceTimersByTime(1600);
    await p;
    expect(resolved).toBe(true);
  });

  it("rejects when the clip cannot be played (status error)", async () => {
    const p = TtsService.speak("Place au Tango !", "file:///c/e.mp3");
    await flush();
    emitStatus({ isLoaded: false, error: "decoder failure" });
    await expect(p).rejects.toThrow(/decoder failure/);
  });

  it("rejects when the native player throws", async () => {
    fakeAnnouncer.replace.mockImplementationOnce(() => {
      throw new Error("bad uri");
    });
    await expect(
      TtsService.speak("Place au Tango !", "file:///c/f.mp3"),
    ).rejects.toThrow(/bad uri/);
  });

  it("stop() ends the pending announcement", async () => {
    const p = TtsService.speak("Place au Tango !", "file:///c/c.mp3");
    await flush();
    await TtsService.stop();
    await expect(p).resolves.toBeUndefined();
    expect(fakeAnnouncer.pause).toHaveBeenCalled();
  });
});
