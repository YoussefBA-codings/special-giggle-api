import { PaginatedResponse } from '../types/index.types';

export function paginate<T>(items: T[], page: number, limit: number): PaginatedResponse<T> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safePage = Math.max(page, 1);
  const total = items.length;
  const totalPages = Math.ceil(total / safeLimit);
  const start = (safePage - 1) * safeLimit;
  const data = items.slice(start, start + safeLimit);

  return { data, meta: { total, page: safePage, limit: safeLimit, totalPages } };
}

export function parseIntParam(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export function parseFloatParam(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? undefined : parsed;
}
