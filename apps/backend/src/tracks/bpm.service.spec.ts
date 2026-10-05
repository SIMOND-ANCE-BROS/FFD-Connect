import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs";
import { BpmService } from "./bpm.service";

// MOCKS
jest.mock("fs");
jest.mock("@ffmpeg-installer/ffmpeg", () => ({
  path: "/fake/ffmpeg",
}));

jest.mock("music-tempo", () => ({
  default: jest.fn().mockImplementation(() => ({
    tempo: "120.5",
  })),
}));

jest.mock("wav-decoder", () => ({
  default: {
    decode: jest.fn().mockResolvedValue({
      channelData: [["data"]],
    }),
  },
}));

// Mock fluent-ffmpeg
interface MockFfmpegInstance {
  setStartTime: jest.Mock;
  setDuration: jest.Mock;
  toFormat: jest.Mock;
  save: jest.Mock;
  on: jest.Mock;
  _endCallback?: () => void | Promise<void>;
  _errorCallback?: (err?: Error) => void | Promise<void>;
}

const mockFfmpeg = jest.fn((): MockFfmpegInstance => {
  const instance: MockFfmpegInstance = {
    setStartTime: jest.fn().mockReturnThis(),
    setDuration: jest.fn().mockReturnThis(),
    toFormat: jest.fn().mockReturnThis(),
    save: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function (
      this: MockFfmpegInstance,
      event: string,
      callback: (() => void | Promise<void>) | ((err: Error) => void),
    ) {
      if (event === "end") {
        this._endCallback = callback as () => void | Promise<void>;
      } else if (event === "error") {
        this._errorCallback = callback;
      }
      return this;
    }),
  };
  return instance;
});
(mockFfmpeg as jest.Mock & { setFfmpegPath: jest.Mock }).setFfmpegPath =
  jest.fn();

jest.mock("fluent-ffmpeg", () => mockFfmpeg);

describe("BpmService", () => {
  let service: BpmService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [BpmService],
    }).compile();

    service = module.get<BpmService>(BpmService);
  });

  describe("analyzeBpm", () => {
    it("should analyze BPM correctly from a file", async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from("mock"));
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);

      const promise = service.analyzeBpm("test.mp3");

      // Wait a tick for async loaders
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Find the ffmpeg instance and trigger 'end'
      const ffmpegInstance = mockFfmpeg.mock.results[0]
        .value as MockFfmpegInstance;
      await ffmpegInstance._endCallback();

      const result = await promise;
      expect(result).toBe(120.5);
      expect(fs.readFileSync).toHaveBeenCalled();
    });

    it("should reject on ffmpeg error", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const promise = service.analyzeBpm("test.mp3");

      // Wait a tick for async loaders
      await new Promise((resolve) => setTimeout(resolve, 0));

      const ffmpegInstance = mockFfmpeg.mock.results[0]
        .value as MockFfmpegInstance;
      void ffmpegInstance._errorCallback(new Error("ffmpeg failed"));

      await expect(promise).rejects.toThrow("ffmpeg failed");
    });

    it("should handle decoding errors", async () => {
      const WavDecoder = require("wav-decoder");
      jest
        .spyOn(WavDecoder.default, "decode")
        .mockRejectedValueOnce(new Error("decode failed"));

      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from("mock"));
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const promise = service.analyzeBpm("test.mp3");

      // Wait a tick for async loaders
      await new Promise((resolve) => setTimeout(resolve, 0));

      const ffmpegInstance = mockFfmpeg.mock.results[0]
        .value as MockFfmpegInstance;
      await ffmpegInstance._endCallback();

      await expect(promise).rejects.toThrow("decode failed");
    });
  });

  describe("calculateMpm", () => {
    it("should return 0 for 0 BPM", () => {
      expect(service.calculateMpm(0)).toBe(0);
    });

    it("converts in-range BPM for Standard dances (÷ beats/measure)", () => {
      // Slow Waltz: ~84-90 BPM, 3/4 → ~28-30 MPM
      expect(service.calculateMpm(90, "Valse Lente")).toBe(30);
      expect(service.calculateMpm(90, "Waltz")).toBe(30);
      // Viennoise/Vienne: ~174-180 BPM, 3/4 → ~58-60 MPM
      expect(service.calculateMpm(180, "Viennoise")).toBe(60);
      expect(service.calculateMpm(180, "Vienne")).toBe(60);
      // Tango: ~124-132 BPM, 4/4 → ~31-33 MPM
      expect(service.calculateMpm(128, "Tango")).toBe(32);
      // Slow Fox: ~112-120 BPM, 4/4 → ~28-30 MPM
      expect(service.calculateMpm(120, "Slow Fox")).toBe(30);
      // Quickstep: ~200-208 BPM, 4/4 → ~50-52 MPM
      expect(service.calculateMpm(200, "Quickstep")).toBe(50);
    });

    it("converts in-range BPM for Latin dances (÷ beats/measure)", () => {
      // Samba: ~100-104 BPM, 2/4 → ~50-52 MPM
      expect(service.calculateMpm(100, "Samba")).toBe(50);
      // Paso Doble: ~120-124 BPM, 2/4 → ~60-62 MPM
      expect(service.calculateMpm(120, "Paso Doble")).toBe(60);
      // Cha-Cha-Cha: ~120-128 BPM, 4/4 → ~30-32 MPM
      expect(service.calculateMpm(128, "Cha-Cha-Cha")).toBe(32);
      expect(service.calculateMpm(128, "Cha-cha")).toBe(32);
      // Rumba: ~100-108 BPM, 4/4 → ~25-27 MPM
      expect(service.calculateMpm(100, "Rumba")).toBe(25);
      // Jive: ~168-176 BPM, 4/4 → ~42-44 MPM
      expect(service.calculateMpm(168, "Jive")).toBe(42);
    });

    it("corrects octave-doubled detections (×2 too high)", () => {
      // Real-world: Samba detected at 184 BPM by music-tempo → halve → 92 → MPM 46
      expect(service.calculateMpm(184, "Samba")).toBe(46);
      // Rumba detected at 200 → 100 → 25 MPM
      expect(service.calculateMpm(200, "Rumba")).toBe(25);
    });

    it("corrects octave-halved detections (÷2 too low)", () => {
      // Quickstep detected at 100 (half tempo) → ×2 → 200 → 50 MPM
      expect(service.calculateMpm(100, "Quickstep")).toBe(50);
      // Samba detected at 50 → ×2 → 100 → 50 MPM
      expect(service.calculateMpm(50, "Samba")).toBe(50);
    });

    it("returns raw BPM when style is unknown, missing, or ambiguous", () => {
      // Federation umbrella categories aren't specific dances → can't normalize.
      expect(service.calculateMpm(120, "LATIN")).toBe(120);
      expect(service.calculateMpm(120, "STANDARD")).toBe(120);
      expect(service.calculateMpm(120, "Unknown")).toBe(120);
      expect(service.calculateMpm(120)).toBe(120);
    });
  });
});
