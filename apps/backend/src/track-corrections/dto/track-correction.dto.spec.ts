import { TrackCorrectionReason } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  LEGACY_REPORT_REASONS,
  ReportTrackDto,
} from "../../tracks/dto/report-track.dto";
import { UpdateTrackDto } from "../../tracks/dto/update-track.dto";
import { PASO_MAX_CLASHES } from "../../tracks/paso-clashes";
import {
  ApproveTrackCorrectionDto,
  CreateTrackCorrectionDto,
  PROPOSABLE_REASONS,
} from "./track-correction.dto";

/**
 * Un paso doble comporte 2 ou 3 clashs selon la coupe, jamais plus : la borne
 * vaut pour la proposition, la validation (ajustements admin) et l'édition
 * admin directe.
 */
describe("bornes des clashs paso doble", () => {
  const failed = <T extends object>(cls: new () => T, payload: object) =>
    validateSync(plainToInstance(cls, payload)).map((e) => e.property);

  const create = (clashTimecodes: number[]) => ({
    trackId: "8b0f2c1e-4a9d-4c3b-9f1e-2a7d5c6b8e90",
    reason: TrackCorrectionReason.PASO_CLASH,
    clashTimecodes,
  });

  it("la borne est de 3", () => {
    expect(PASO_MAX_CLASHES).toBe(3);
  });

  it("accepte 0 à 3 clashs proposés", () => {
    expect(failed(CreateTrackCorrectionDto, create([]))).toEqual([]);
    expect(failed(CreateTrackCorrectionDto, create([40]))).toEqual([]);
    expect(failed(CreateTrackCorrectionDto, create([40, 80]))).toEqual([]);
    expect(failed(CreateTrackCorrectionDto, create([40, 80, 120]))).toEqual([]);
  });

  it("refuse 4 clashs proposés", () => {
    expect(
      failed(CreateTrackCorrectionDto, create([40, 80, 120, 160])),
    ).toEqual(["clashTimecodes"]);
  });

  it("refuse 4 clashs dans les ajustements de l'admin", () => {
    expect(
      failed(ApproveTrackCorrectionDto, { clashTimecodes: [40, 80, 120, 160] }),
    ).toEqual(["clashTimecodes"]);
  });

  it("édition admin directe (PATCH /tracks/:id) : 3 acceptés, 4 refusés", () => {
    expect(
      failed(UpdateTrackDto, { clashTimecodes: [40, 80, 120, 160] }),
    ).toEqual(["clashTimecodes"]);
    expect(failed(UpdateTrackDto, { clashTimecodes: [40, 80, 120] })).toEqual(
      [],
    );
  });
});

/**
 * `DELETE` (#446) part seul, avant son producteur : la base et le client
 * Prisma le connaissent, mais aucune route ne l'accepte encore.
 */
describe("motif DELETE (livré avant son producteur)", () => {
  const failed = <T extends object>(cls: new () => T, payload: object) =>
    validateSync(plainToInstance(cls, payload)).map((e) => e.property);

  it("est refusé par POST /track-corrections", () => {
    expect(
      failed(CreateTrackCorrectionDto, {
        trackId: "8b0f2c1e-4a9d-4c3b-9f1e-2a7d5c6b8e90",
        reason: TrackCorrectionReason.DELETE,
        message: "Doublon",
      }),
    ).toEqual(["reason"]);
  });

  it("n'est pas proposable, les autres motifs le restent", () => {
    expect(PROPOSABLE_REASONS).not.toContain(TrackCorrectionReason.DELETE);
    expect(PROPOSABLE_REASONS).toContain(TrackCorrectionReason.OTHER);
  });

  it("est refusé par la route historique de signalement", () => {
    expect(
      failed(ReportTrackDto, { reason: TrackCorrectionReason.DELETE }),
    ).toEqual(["reason"]);
    expect(
      failed(ReportTrackDto, { reason: TrackCorrectionReason.OTHER }),
    ).toEqual([]);
    expect(LEGACY_REPORT_REASONS).not.toContain(TrackCorrectionReason.DELETE);
  });
});
