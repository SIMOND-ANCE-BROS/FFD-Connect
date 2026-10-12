import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  listOrderBy,
  SortByParam,
  SortOrderParam,
  type SortOrder,
} from "./sort-params";

const FIELDS = ["name", "createdAt"] as const;

class Probe {
  @SortByParam(FIELDS)
  sortBy?: (typeof FIELDS)[number];

  @SortOrderParam()
  sortOrder?: SortOrder;
}

const errors = (value: Record<string, unknown>) =>
  validateSync(plainToInstance(Probe, value)).map((e) => e.property);

describe("sort params", () => {
  it("accepts a whitelisted field and order, or nothing", () => {
    expect(errors({ sortBy: "name", sortOrder: "desc" })).toEqual([]);
    expect(errors({})).toEqual([]);
  });

  it("refuses a field outside the whitelist", () => {
    expect(errors({ sortBy: "password" })).toEqual(["sortBy"]);
  });

  it("refuses an unknown order", () => {
    expect(errors({ sortBy: "name", sortOrder: "DESC" })).toEqual([
      "sortOrder",
    ]);
  });
});

describe("listOrderBy", () => {
  const orders = {
    name: (o: SortOrder) => [{ name: o }, { id: o }],
    createdAt: (o: SortOrder) => [{ createdAt: o }],
  };
  const fallback = [{ id: "desc" as SortOrder }];

  it("uses the default order without sortBy, even with a sortOrder", () => {
    expect(listOrderBy(undefined, "asc", orders, fallback)).toBe(fallback);
  });

  it("sorts ascending by default", () => {
    expect(listOrderBy("name", undefined, orders, fallback)).toEqual([
      { name: "asc" },
      { id: "asc" },
    ]);
  });

  it("applies the requested order", () => {
    expect(listOrderBy("createdAt", "desc", orders, fallback)).toEqual([
      { createdAt: "desc" },
    ]);
  });
});
