import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

export const toPagination = ({ page, pageSize }: { page: number; pageSize: number }) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

export const paginated = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  pagination: {
    page,
    pageSize,
    total,
    pages: Math.ceil(total / pageSize),
  },
});
