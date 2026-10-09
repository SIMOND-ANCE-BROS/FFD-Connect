import { GUARDS_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AdminTracksController } from "./admin-tracks.controller";
import { AdminTracksQueryService } from "./admin-tracks.query-service";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import {
  TRACK_IMPORT_MULTIPART_LIMITS,
  TrackImportService,
} from "./track-import.service";

describe("AdminTracksController", () => {
  const query = { list: jest.fn(), detail: jest.fn() };
  const importer = { check: jest.fn(), importTrack: jest.fn() };
  const controller = new AdminTracksController(
    query as unknown as AdminTracksQueryService,
    importer as unknown as TrackImportService,
  );
  const req = {
    user: { userId: "admin-1", role: UserRole.ADMIN },
  } as unknown as RequestWithUser;

  beforeEach(() => jest.clearAllMocks());

  it("is guarded and restricted to ADMIN at class level", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminTracksController)).toEqual(
      [JwtAuthGuard, RolesGuard],
    );
    expect(Reflect.getMetadata(ROLES_KEY, AdminTracksController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it("lists the catalogue with the filters", async () => {
    query.list.mockResolvedValue({ data: [], meta: {} });
    const filters = { ambiance: false, skip: 0, take: 50 };
    await expect(controller.list(filters)).resolves.toEqual({
      data: [],
      meta: {},
    });
    expect(query.list).toHaveBeenCalledWith(filters);
  });

  it("returns one track", async () => {
    query.detail.mockResolvedValue({ id: "t1" });
    await expect(controller.findOne("t1")).resolves.toEqual({ id: "t1" });
    expect(query.detail).toHaveBeenCalledWith("t1");
  });

  it("checks duplicates for the items", async () => {
    importer.check.mockResolvedValue({ items: [{ exists: false }] });
    await expect(
      controller.check({ items: [{ sha256: "a".repeat(64) }] }),
    ).resolves.toEqual({
      items: [{ exists: false }],
    });
    expect(importer.check).toHaveBeenCalledWith([{ sha256: "a".repeat(64) }]);
  });

  it("imports the first audio and artwork parts, with the caller as actor", async () => {
    importer.importTrack.mockResolvedValue({ id: "t1" });
    const body = { title: "T", artist: "A", sha256: "a".repeat(64) };
    const audio = {
      buffer: Buffer.from("ID3"),
      size: 3,
    } as Express.Multer.File;
    const artwork = {
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      size: 3,
    } as Express.Multer.File;

    await expect(
      controller.create(req, body, { audio: [audio], artwork: [artwork] }),
    ).resolves.toEqual({
      id: "t1",
    });
    expect(importer.importTrack).toHaveBeenCalledWith(
      "admin-1",
      body,
      audio,
      artwork,
    );

    await controller.create(req, body, undefined);
    expect(importer.importTrack).toHaveBeenLastCalledWith(
      "admin-1",
      body,
      undefined,
      undefined,
    );
  });

  it("limits the multipart body of this route only", () => {
    expect(TRACK_IMPORT_MULTIPART_LIMITS).toEqual({
      fileSize: 20 * 1024 * 1024,
      files: 2,
      fields: 10,
      fieldSize: 1024,
      parts: 12,
    });
  });
});
