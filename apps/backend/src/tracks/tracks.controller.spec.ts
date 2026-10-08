import { NotFoundException, StreamableFile } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { Response } from "express";
import { validateHeaderValue } from "http";
import * as fs from "fs";
import * as path from "path";
import { UserRole } from "@prisma/client";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { BlobStorageService } from "../storage/blob-storage.service";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";

jest.mock("fs");

describe("TracksController", () => {
  let controller: TracksController;

  const mockTracksService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findAmbiance: jest.fn(),
    updateTrack: jest.fn(),
    deleteTrack: jest.fn(),
  };

  const adminReq = {
    user: { userId: "admin-1", role: "ADMIN" },
  } as Parameters<TracksController["findAll"]>[1];
  const licenseeReq = {
    user: { userId: "user-1", role: "LICENSEE" },
  } as Parameters<TracksController["findAll"]>[1];

  const mockResponse = {
    set: jest.fn(),
  } as unknown as Response;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TracksController],
      providers: [
        { provide: TracksService, useValue: mockTracksService },
        {
          provide: BlobStorageService,
          useValue: {
            isEnabled: jest.fn().mockReturnValue(false),
            exists: jest.fn().mockResolvedValue(false),
            downloadStream: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<TracksController>(TracksController);
  });

  // ─── findAmbiance ────────────────────────────────────────────────────────────

  describe("findAmbiance", () => {
    it("returns the ambiance tracks from the service", async () => {
      const tracks = [{ id: "a1", title: "Lounge", artist: "Ambiance" }];
      mockTracksService.findAmbiance.mockResolvedValue(tracks);

      const result = await controller.findAmbiance(licenseeReq);

      expect(result).toEqual(tracks);
      expect(mockTracksService.findAmbiance).toHaveBeenCalledWith(false);
    });

    it("forwards the admin flag to the service", async () => {
      mockTracksService.findAmbiance.mockResolvedValue([]);

      await controller.findAmbiance(adminReq);

      expect(mockTracksService.findAmbiance).toHaveBeenCalledWith(true);
    });

    it("is routed before GET /tracks/:id so 'ambiance' is not taken as an id", () => {
      const proto = TracksController.prototype;
      const methods = Object.getOwnPropertyNames(proto);
      expect(methods.indexOf("findAmbiance")).toBeLessThan(
        methods.indexOf("findOne"),
      );
      expect(Reflect.getMetadata("path", proto.findAmbiance)).toBe("ambiance");
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe("findAll", () => {
    const makePaginatedResponse = (data: object[], total = data.length) => ({
      data,
      meta: { total, skip: 0, take: 10, hasMore: total > data.length },
    });

    it("returns the paginated response from the service", async () => {
      const response = makePaginatedResponse([
        { id: "track-1", title: "Track A", bpm: 120 },
        { id: "track-2", title: "Track B", bpm: 90 },
      ]);
      mockTracksService.findAll.mockResolvedValue(response);

      const pagination: PaginationParamsDto = { skip: 0, take: 10 };
      const result = await controller.findAll(pagination, licenseeReq);

      expect(result).toEqual(response);
    });

    it("forwards the pagination params and admin flag to the service", async () => {
      const pagination: PaginationParamsDto = { skip: 20, take: 5 };
      mockTracksService.findAll.mockResolvedValue(
        makePaginatedResponse([], 50),
      );

      await controller.findAll(pagination, adminReq);

      expect(mockTracksService.findAll).toHaveBeenCalledTimes(1);
      expect(mockTracksService.findAll).toHaveBeenCalledWith(pagination, true);
    });

    it("shows hidden tracks to an account whose ADMIN role is an extra role", async () => {
      const pagination: PaginationParamsDto = { skip: 0, take: 10 };
      mockTracksService.findAll.mockResolvedValue(makePaginatedResponse([]));

      await controller.findAll(pagination, {
        user: {
          userId: "u1",
          email: "a@x.fr",
          role: "LICENSEE",
          roles: [UserRole.LICENSEE, UserRole.ADMIN],
        },
      } as Parameters<TracksController["findAll"]>[1]);

      expect(mockTracksService.findAll).toHaveBeenCalledWith(pagination, true);
    });

    it("passes isAdmin=false for a non-admin requester", async () => {
      const pagination: PaginationParamsDto = { skip: 0, take: 10 };
      mockTracksService.findAll.mockResolvedValue(makePaginatedResponse([]));

      await controller.findAll(pagination, licenseeReq);

      expect(mockTracksService.findAll).toHaveBeenCalledWith(pagination, false);
    });

    it("returns an empty data array with correct meta when no tracks exist", async () => {
      const empty = makePaginatedResponse([]);
      mockTracksService.findAll.mockResolvedValue(empty);

      const result = await controller.findAll(
        { skip: 0, take: 10 },
        licenseeReq,
      );

      expect(result).toEqual(empty);
      expect((result as typeof empty).data).toHaveLength(0);
    });

    it("propagates service errors to the caller", async () => {
      mockTracksService.findAll.mockRejectedValue(new Error("DB unavailable"));

      await expect(
        controller.findAll({ skip: 0, take: 10 }, licenseeReq),
      ).rejects.toThrow("DB unavailable");
    });
  });

  // ─── findOne (GET /tracks/:id) ─────────────────────────────────────────────

  describe("findOne", () => {
    it("returns the track from the service", async () => {
      const track = { id: "track-1", title: "Track A", bpm: 120 };
      mockTracksService.findOne.mockResolvedValue(track);

      const result = await controller.findOne("track-1", licenseeReq);

      expect(result).toEqual(track);
    });

    it("forwards the id and isAdmin=true for an admin requester", async () => {
      mockTracksService.findOne.mockResolvedValue({ id: "track-1" });

      await controller.findOne("track-1", adminReq);

      expect(mockTracksService.findOne).toHaveBeenCalledWith("track-1", true);
    });

    it("forwards isAdmin=false for a non-admin requester", async () => {
      mockTracksService.findOne.mockResolvedValue({ id: "track-1" });

      await controller.findOne("track-1", licenseeReq);

      expect(mockTracksService.findOne).toHaveBeenCalledWith("track-1", false);
    });

    it("propagates NotFoundException from the service", async () => {
      mockTracksService.findOne.mockRejectedValue(
        new NotFoundException("Track track-x not found"),
      );

      await expect(controller.findOne("track-x", licenseeReq)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── update (PATCH /tracks/:id) ────────────────────────────────────────────

  describe("update", () => {
    it("updates the track then returns the refreshed track", async () => {
      const updated = { id: "track-1", title: "New title" };
      mockTracksService.updateTrack.mockResolvedValue(undefined);
      mockTracksService.findOne.mockResolvedValue(updated);

      const dto = { title: "New title" };
      const result = await controller.update("track-1", dto, adminReq);

      expect(mockTracksService.updateTrack).toHaveBeenCalledWith(
        "track-1",
        "admin-1",
        true,
        dto,
      );
      expect(mockTracksService.findOne).toHaveBeenCalledWith("track-1", true);
      expect(result).toEqual(updated);
    });

    it("forwards userId and isAdmin=false for a non-admin requester", async () => {
      mockTracksService.updateTrack.mockResolvedValue(undefined);
      mockTracksService.findOne.mockResolvedValue({ id: "track-1" });

      await controller.update("track-1", { bpm: 100 }, licenseeReq);

      expect(mockTracksService.updateTrack).toHaveBeenCalledWith(
        "track-1",
        "user-1",
        false,
        { bpm: 100 },
      );
    });

    it("propagates NotFoundException from the service", async () => {
      mockTracksService.updateTrack.mockRejectedValue(
        new NotFoundException("Track track-x not found"),
      );

      await expect(
        controller.update("track-x", { title: "x" }, adminReq),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove (DELETE /tracks/:id) ───────────────────────────────────────────

  describe("remove", () => {
    it("delegates to the service deleteTrack", async () => {
      mockTracksService.deleteTrack.mockResolvedValue(undefined);

      await controller.remove("track-1");

      expect(mockTracksService.deleteTrack).toHaveBeenCalledWith("track-1");
    });

    it("propagates NotFoundException from the service", async () => {
      mockTracksService.deleteTrack.mockRejectedValue(
        new NotFoundException("Track track-x not found"),
      );

      await expect(controller.remove("track-x")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── download ────────────────────────────────────────────────────────────────

  describe("download", () => {
    const fakeStream = { pipe: jest.fn() };

    it("returns a StreamableFile when the requested file exists", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.createReadStream as jest.Mock).mockReturnValue(fakeStream);

      const result = await controller.download("abc123.mp3", mockResponse);

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it("sets the correct Content-Type and Content-Disposition headers", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.createReadStream as jest.Mock).mockReturnValue(fakeStream);

      await controller.download(
        "STANDARD | Artist - Title (1).mp3",
        mockResponse,
      );

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          "Content-Type": "audio/mpeg",
          "Content-Disposition": expect.stringContaining("attachment"),
        }),
      );
    });

    it("opens the correct file path derived from the token", async () => {
      const token = "deadbeef.mp3";
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.createReadStream as jest.Mock).mockReturnValue(fakeStream);

      await controller.download(token, mockResponse);

      // path.basename strips any traversal segments; the resolved path must end with the token
      const calledPath = (fs.createReadStream as jest.Mock).mock
        .calls[0][0] as string;
      expect(calledPath).toMatch(new RegExp(`${path.basename(token)}$`));
    });

    it("sanitises directory-traversal attempts by calling path.basename on the token", async () => {
      const traversalToken = "../../../etc/passwd";
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        controller.download(traversalToken, mockResponse),
      ).rejects.toThrow(NotFoundException);

      // existsSync must have been called with the sanitised path, not the raw traversal
      const checkedPath = (fs.existsSync as jest.Mock).mock
        .calls[0][0] as string;
      expect(checkedPath).not.toContain("..");
      expect(checkedPath).toMatch(/passwd$/);
    });

    it("throws NotFoundException when the file does not exist on disk", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        controller.download("missing.mp3", mockResponse),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException with message 'File not found'", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        controller.download("ghost.mp3", mockResponse),
      ).rejects.toThrow("File not found");
    });

    it("does not call createReadStream when the file does not exist", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        controller.download("no-file.mp3", mockResponse),
      ).rejects.toThrow(NotFoundException);
      expect(fs.createReadStream).not.toHaveBeenCalled();
    });
  });

  describe("download (Blob Storage enabled)", () => {
    let blobController: TracksController;
    const fakeStream = { pipe: jest.fn() };
    const mockBlobEnabled = {
      isEnabled: jest.fn().mockReturnValue(true),
      exists: jest.fn(),
      downloadStream: jest.fn(),
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      const module: TestingModule = await Test.createTestingModule({
        controllers: [TracksController],
        providers: [
          { provide: TracksService, useValue: mockTracksService },
          { provide: BlobStorageService, useValue: mockBlobEnabled },
        ],
      }).compile();
      blobController = module.get<TracksController>(TracksController);
    });

    it("streams from Blob Storage when blob exists", async () => {
      mockBlobEnabled.exists.mockResolvedValue(true);
      mockBlobEnabled.downloadStream.mockResolvedValue(fakeStream);

      const result = await blobController.download("track.mp3", mockResponse);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(mockBlobEnabled.downloadStream).toHaveBeenCalledWith("track.mp3");
      expect(fs.existsSync).not.toHaveBeenCalled();
    });

    it("sets valid headers for a real track name with a non-ASCII character (500 regression)", async () => {
      // Exact blob name from staging: the fullwidth bar U+FF5C used to reach
      // Content-Disposition raw and crash with ERR_INVALID_CHAR.
      const name = "04-JIVE ｜ Dj Ice - Blinding Lights (39 MPM).mp3";
      mockBlobEnabled.exists.mockResolvedValue(true);
      mockBlobEnabled.downloadStream.mockResolvedValue(fakeStream);

      await blobController.download(name, mockResponse);

      const headers = (mockResponse.set as jest.Mock).mock
        .calls[0][0] as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        expect(() => validateHeaderValue(key, value)).not.toThrow();
      }
      expect(headers["Content-Type"]).toBe("audio/mpeg");
      expect(headers["Content-Disposition"]).toBe(
        `attachment; filename="04-JIVE _ Dj Ice - Blinding Lights (39 MPM).mp3"; ` +
          `filename*=UTF-8''04-JIVE%20%EF%BD%9C%20Dj%20Ice%20-%20Blinding%20Lights%20%2839%20MPM%29.mp3`,
      );
      expect(mockBlobEnabled.downloadStream).toHaveBeenCalledWith(name);
    });

    it("derives Content-Type from the extension for artwork", async () => {
      mockBlobEnabled.exists.mockResolvedValue(true);
      mockBlobEnabled.downloadStream.mockResolvedValue(fakeStream);

      await blobController.download("cover.jpg", mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({ "Content-Type": "image/jpeg" }),
      );
    });

    it("throws NotFoundException when blob does not exist", async () => {
      mockBlobEnabled.exists.mockResolvedValue(false);

      await expect(
        blobController.download("missing.mp3", mockResponse),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
