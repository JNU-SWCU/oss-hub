import type { MatrixCell, MatrixRow } from './types';

export const MATRIX_PAGE_SIZE = 20;
export const MATRIX_DEFAULT_ORDER = { sort: 'team', direction: 'asc' } as const;

export type MatrixSort = 'team' | 'progress' | `milestone:${string}`;

export interface MatrixQueryInput {
  readonly q: string;
  readonly page: number;
  readonly pageSize: number;
  readonly status?: MatrixCell['status'];
  readonly sort: MatrixSort;
  readonly direction: 'asc' | 'desc';
}

export function buildMatrixSearchParams(
  input: MatrixQueryInput,
): URLSearchParams {
  const params = new URLSearchParams();
  const q = input.q.trim();
  if (q !== '') params.set('q', q);
  if (input.status !== undefined) params.set('status', input.status);
  params.set('sort', input.sort);
  params.set('direction', input.direction);
  params.set('page', String(input.page));
  params.set('pageSize', String(input.pageSize));
  return params;
}

export function matrixTotalPages(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

export function cellForMilestone(
  row: MatrixRow,
  milestoneId: string,
): MatrixCell {
  return (
    row.cells.find((cell) => cell.milestoneId === milestoneId) ?? {
      milestoneId,
      submissionId: null,
      revision: null,
      status: 'NOT_SUBMITTED',
      deliveryStatus: 'MISSING',
      submittedAt: null,
      changesRequestedCount: 0,
    }
  );
}

export function isMatrixFilterActive(q: string): boolean {
  return q.trim() !== '';
}
