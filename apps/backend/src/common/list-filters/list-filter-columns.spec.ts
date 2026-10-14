import { ADMIN_CLUBS_FILTER_COLUMNS } from "../../admin/dto/admin-clubs.dto";
import { AUDIT_FILTER_COLUMNS } from "../../admin/dto/admin-audit.dto";
import { ADMIN_USERS_FILTER_COLUMNS } from "../../admin/dto/admin-users.dto";
import { ADMIN_RENEWALS_FILTER_COLUMNS } from "../../licenses/dto/admin-license-renewal.dto";
import { TRACK_CORRECTION_FILTER_COLUMNS } from "../../track-corrections/dto/track-correction.dto";
import { ADMIN_TRACKS_FILTER_COLUMNS } from "../../tracks/dto/admin-track.dto";
import {
  allowedOps,
  type FilterColumn,
  type FilterColumns,
  type ListFilter,
  type ListFilterOp,
  type ListFilterValue,
  listFiltersError,
  listFiltersWhere,
} from "./list-filters";

const sample = <Where>(
  column: FilterColumn<Where>,
  op: ListFilterOp,
): ListFilterValue | undefined => {
  if (op === "isEmpty" || op === "isNotEmpty") return undefined;
  switch (column.kind) {
    case "text":
      return "mar";
    case "date":
      return op === "between" ? ["2026-01-01", "2026-12-31"] : "2026-10-14";
    case "number":
      return op === "between" ? [28, 31] : 30;
    case "enum":
      return [column.values[0]];
  }
};

const LISTS: [string, FilterColumns<unknown>][] = [
  ["users", ADMIN_USERS_FILTER_COLUMNS],
  ["clubs", ADMIN_CLUBS_FILTER_COLUMNS],
  ["audit log", AUDIT_FILTER_COLUMNS],
  ["tracks", ADMIN_TRACKS_FILTER_COLUMNS],
  ["track corrections", TRACK_CORRECTION_FILTER_COLUMNS],
  ["licence renewals", ADMIN_RENEWALS_FILTER_COLUMNS],
];

describe("filter whitelists of the 6 back-office lists (#557)", () => {
  it.each(LISTS)(
    "%s: every field accepts each of its operators",
    (_list, columns) => {
      for (const [field, column] of Object.entries(columns)) {
        const ops = allowedOps({
          kind: column.kind,
          nullable: column.whereNull !== undefined,
        });
        for (const op of ops) {
          const filter: ListFilter = { field, op, value: sample(column, op) };
          expect(listFiltersError(columns, [filter])).toBeNull();
          const [where] = listFiltersWhere(columns, [filter]);
          expect(where).toEqual(expect.any(Object));
        }
      }
    },
  );

  it("filters users by main or extra role, like the role parameter", () => {
    expect(
      listFiltersWhere(ADMIN_USERS_FILTER_COLUMNS, [
        { field: "role", op: "in", value: ["CLUB"] },
      ]),
    ).toEqual([
      { OR: [{ OR: [{ role: "CLUB" }, { extraRoles: { has: "CLUB" } }] }] },
    ]);
  });

  it("never exposes a secret column", () => {
    for (const [, columns] of LISTS) {
      expect(Object.keys(columns)).not.toEqual(
        expect.arrayContaining(["password"]),
      );
    }
    expect(Object.keys(ADMIN_CLUBS_FILTER_COLUMNS)).not.toContain(
      "helloAssoClientSecret",
    );
  });
});
