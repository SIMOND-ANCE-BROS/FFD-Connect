import { HttpException, HttpStatus } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Response } from "express";

// Mock TtsService BEFORE importing the controller to avoid loading gRPC / Google Cloud deps
jest.mock("./tts.service", () => ({
  TtsService: jest.fn().mockImplementation(() => ({
    getTtsAudio: jest.fn(),
  })),
}));

// Mock fs.createReadStream
const mockPipe = jest.fn();
jest.mock("fs", () => ({
  createReadStream: jest.fn(() => ({ pipe: mockPipe })),
}));

import * as fs from "fs";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { TtsController } from "./tts.controller";
import { TtsService } from "./tts.service";

describe("TtsController", () => {
  let controller: TtsController;
  let mockTtsService: { getTtsAudio: jest.Mock };

  const makeRes = (): jest.Mocked<Pick<Response, "setHeader">> => ({
    setHeader: jest.fn(),
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    mockTtsService = { getTtsAudio: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TtsController],
      providers: [{ provide: TtsService, useValue: mockTtsService }],
    })
      // Guards and validation are covered over HTTP in tts.http.spec.ts.
      .overrideGuard(ThrottlerUserGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TtsController>(TtsController);
  });

  describe("speak", () => {
    it("calls service.getTtsAudio with the provided text on success", async () => {
      const res = makeRes() as unknown as Response;
      mockTtsService.getTtsAudio.mockResolvedValue("/cache/hello.mp3");

      await controller.speak({ text: "Hello" }, res);

      expect(mockTtsService.getTtsAudio).toHaveBeenCalledWith("Hello");
    });

    it("sets Content-Type to audio/mpeg before piping the stream", async () => {
      const res = makeRes() as unknown as Response;
      mockTtsService.getTtsAudio.mockResolvedValue("/cache/hello.mp3");

      await controller.speak({ text: "Hello" }, res);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "audio/mpeg");
    });

    it("opens a read stream for the file path returned by the service", async () => {
      const res = makeRes() as unknown as Response;
      mockTtsService.getTtsAudio.mockResolvedValue("/cache/bonjour.mp3");

      await controller.speak({ text: "Bonjour" }, res);

      expect(fs.createReadStream).toHaveBeenCalledWith("/cache/bonjour.mp3");
    });

    it("pipes the read stream to the response object", async () => {
      const res = makeRes() as unknown as Response;
      mockTtsService.getTtsAudio.mockResolvedValue("/cache/audio.mp3");

      await controller.speak({ text: "Test" }, res);

      expect(mockPipe).toHaveBeenCalledWith(res);
    });

    it("throws INTERNAL_SERVER_ERROR with a descriptive message when service fails", async () => {
      const res = makeRes() as unknown as Response;
      mockTtsService.getTtsAudio.mockRejectedValue(new Error("API Error"));

      await expect(controller.speak({ text: "Hello" }, res)).rejects.toThrow(
        new HttpException(
          "TTS Generation failed: API Error",
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });

    it("includes the original error message in the INTERNAL_SERVER_ERROR body", async () => {
      const res = makeRes() as unknown as Response;
      mockTtsService.getTtsAudio.mockRejectedValue(new Error("quota exceeded"));

      try {
        await controller.speak({ text: "Test" }, res);
        fail("Expected HttpException to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(httpErr.message).toMatch(/quota exceeded/);
      }
    });

    it("does not call createReadStream when service throws", async () => {
      const res = makeRes() as unknown as Response;
      mockTtsService.getTtsAudio.mockRejectedValue(new Error("fail"));

      await expect(controller.speak({ text: "Hello" }, res)).rejects.toThrow(
        HttpException,
      );
      expect(fs.createReadStream).not.toHaveBeenCalled();
    });
  });
});
