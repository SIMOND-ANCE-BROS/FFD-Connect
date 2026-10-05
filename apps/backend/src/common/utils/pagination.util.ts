import { PaginatedResponse } from "../dto/pagination-params.dto";

export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  skip: number,
  take: number,
): PaginatedResponse<T> {
  return {
    data,
    meta: {
      total,
      skip,
      take,
      hasMore: skip + data.length < total,
    },
  };
}
