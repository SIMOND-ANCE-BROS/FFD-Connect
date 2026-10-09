import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  ListAuditLogQueryDto,
} from "./admin-audit.dto";

describe("ListAuditLogQueryDto", () => {
  const errors = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(ListAuditLogQueryDto, plain)).map(
      (e) => e.property,
    );

  it("accepts track corrections and tracks as target types", () => {
    expect(errors({ targetType: "TRACK_CORRECTION" })).toEqual([]);
    expect(errors({ targetType: "TRACK" })).toEqual([]);
  });

  it("refuses an unknown target type", () => {
    expect(errors({ targetType: "COMPETITION" })).toEqual(["targetType"]);
  });

  it("knows the moderation decisions and the track writes", () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        "TRACK_CORRECTION_APPROVE",
        "TRACK_CORRECTION_REJECT",
        "TRACK_CREATE",
        "TRACK_UPDATE",
        "TRACK_DELETE",
      ]),
    );
    expect(AUDIT_TARGET_TYPES).toEqual([
      "USER",
      "CLUB",
      "TRACK_CORRECTION",
      "TRACK",
    ]);
  });
});
