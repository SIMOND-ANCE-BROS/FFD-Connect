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

  it("accepts track corrections as a target type", () => {
    expect(errors({ targetType: "TRACK_CORRECTION" })).toEqual([]);
  });

  it("refuses an unknown target type", () => {
    expect(errors({ targetType: "TRACK" })).toEqual(["targetType"]);
  });

  it("knows the moderation decisions", () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        "TRACK_CORRECTION_APPROVE",
        "TRACK_CORRECTION_REJECT",
      ]),
    );
    expect(AUDIT_TARGET_TYPES).toEqual(["USER", "CLUB", "TRACK_CORRECTION"]);
  });
});
