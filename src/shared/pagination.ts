import { z } from 'zod';

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z
    .string()
    .trim()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*(:(asc|desc))?$/, 'formato esperado: campo:asc|campo:desc')
    .optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface PagedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export function paged<T>(rows: T[], total: number, query: PaginationQuery): PagedResponse<T> {
  const totalPages = query.page_size > 0 ? Math.max(1, Math.ceil(total / query.page_size)) : 1;
  return {
    data: rows,
    pagination: {
      page: query.page,
      page_size: query.page_size,
      total,
      total_pages: totalPages,
    },
  };
}

export function parseSort(
  input: string | undefined,
  allowed: readonly string[],
  fallback: { column: string; dir: 'ASC' | 'DESC' }
): { column: string; dir: 'ASC' | 'DESC' } {
  if (!input) return fallback;
  const [col, dirRaw] = input.split(':');
  if (!col || !allowed.includes(col)) return fallback;
  const dir = (dirRaw ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return { column: col, dir };
}
