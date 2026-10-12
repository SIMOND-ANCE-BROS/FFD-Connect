import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { ListAdminLicenseRenewalsQueryDto } from "../../licenses/dto/admin-license-renewal.dto";
import { ListTrackCorrectionsQueryDto } from "../../track-corrections/dto/track-correction.dto";
import { ListAdminTracksQueryDto } from "../../tracks/dto/admin-track.dto";
import { ListAuditLogQueryDto } from "./admin-audit.dto";
import { ListAdminClubsQueryDto } from "./admin-clubs.dto";
import { ListAdminUsersQueryDto } from "./admin-users.dto";

// Column sorting of the back-office lists (#443): the sort field is a
// whitelist per list, never an arbitrary column name.
const LISTS = [
  ["users", ListAdminUsersQueryDto, "lastLoginAt"],
  ["clubs", ListAdminClubsQueryDto, "createdAt"],
  ["audit log", ListAuditLogQueryDto, "createdAt"],
  ["tracks", ListAdminTracksQueryDto, "bpm"],
  ["moderation", ListTrackCorrectionsQueryDto, "track"],
  ["renewals", ListAdminLicenseRenewalsQueryDto, "submittedAt"],
] as const;

type ListDto = (typeof LISTS)[number][1];

const errors = (dto: ListDto, plain: Record<string, unknown>) =>
  validateSync(plainToInstance(dto, plain)).map((e) => e.property);

describe.each(LISTS)("%s list sort parameters", (_name, dto, field) => {
  it("accepts a whitelisted field in both directions", () => {
    expect(errors(dto, { sortBy: field, sortOrder: "asc" })).toEqual([]);
    expect(errors(dto, { sortBy: field, sortOrder: "desc" })).toEqual([]);
  });

  it.each(["password", "id; DROP TABLE", "user.email"])(
    "refuses %s as a sort field",
    (sortBy) => {
      expect(errors(dto, { sortBy })).toEqual(["sortBy"]);
    },
  );

  it("refuses an unknown direction", () => {
    expect(errors(dto, { sortBy: field, sortOrder: "up" })).toEqual([
      "sortOrder",
    ]);
  });
});

describe("audit log action filter", () => {
  it("accepts a known action and refuses another", () => {
    expect(errors(ListAuditLogQueryDto, { action: "USER_DELETE" })).toEqual([]);
    expect(errors(ListAuditLogQueryDto, { action: "DROP" })).toEqual([
      "action",
    ]);
  });
});
