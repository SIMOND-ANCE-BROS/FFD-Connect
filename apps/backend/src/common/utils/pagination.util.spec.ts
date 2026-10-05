import { createPaginatedResponse } from "./pagination.util";

describe("pagination.util", () => {
  describe("createPaginatedResponse", () => {
    it("returns data with meta (total, skip, take, hasMore)", () => {
      const data = [{ id: 1 }, { id: 2 }];
      const result = createPaginatedResponse(data, 10, 0, 2);

      expect(result.data).toEqual(data);
      expect(result.meta).toEqual({
        total: 10,
        skip: 0,
        take: 2,
        hasMore: true,
      });
    });

    it("sets hasMore to false when no more items", () => {
      const data = [{ id: 1 }, { id: 2 }];
      const result = createPaginatedResponse(data, 2, 0, 2);

      expect(result.meta.hasMore).toBe(false);
      expect(result.meta.total).toBe(2);
    });

    it("computes hasMore from skip + data.length < total", () => {
      const data = [{ id: 1 }];
      const result = createPaginatedResponse(data, 5, 2, 2);

      expect(result.meta.skip).toBe(2);
      expect(result.meta.take).toBe(2);
      expect(result.meta.total).toBe(5);
      expect(result.meta.hasMore).toBe(true); // 2 + 1 < 5
    });

    it("handles empty data array", () => {
      const result = createPaginatedResponse([], 0, 0, 10);

      expect(result.data).toEqual([]);
      expect(result.meta.hasMore).toBe(false);
      expect(result.meta.total).toBe(0);
    });
  });
});
