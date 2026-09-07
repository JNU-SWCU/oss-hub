import { describe, expect, it } from 'vitest';
import {
  applyMatrixQuickFilter,
  matrixRowDeliveryStatus,
  matrixPageStats,
  isLateSubmission,
} from './matrix';
import type { MatrixCell, MatrixRow } from './types';

const milestones = [
  { id: 'first', name: '1차', dueAt: '2026-08-01T00:00:00Z' },
  { id: 'second', name: '2차', dueAt: '2026-08-01T00:00:00Z' },
];
function row(
  statuses: readonly ('MISSING' | 'LATE' | 'COMPLETE' | 'NO_REQUIRED_ITEMS')[],
): MatrixRow {
  return {
    applicationId: 'application',
    applicationMode: 'TEAM',
    displayName: '합성팀',
    githubLogins: [],
    cells: statuses.map((deliveryStatus, index): MatrixCell => ({
      milestoneId: index === 0 ? 'first' : 'second',
      submissionId: 'submission',
      revision: 2,
      status: 'APPROVED',
      submittedAt: '2026-09-01T00:00:00Z',
      reviewUrl: null,
      deliveryStatus,
    })),
  };
}

describe('delivery status filters', () => {
  it('uses first-submission server status even when a revision was submitted late', () => {
    const cell = row(['COMPLETE']).cells[0];
    if (cell === undefined) throw new TypeError('Missing fixture');
    expect(isLateSubmission(cell, milestones[0])).toBe(false);
  });
  it('gives missing precedence over late and keeps approval separate', () => {
    expect(matrixRowDeliveryStatus(row(['LATE', 'MISSING']), milestones)).toBe(
      'MISSING',
    );
  });
  it('ignores optional-only milestones when aggregating completed delivery', () => {
    expect(
      matrixRowDeliveryStatus(
        row(['COMPLETE', 'NO_REQUIRED_ITEMS']),
        milestones,
      ),
    ).toBe('COMPLETE');
  });
  it('keeps optional submissions in no-required state and excludes them from required totals', () => {
    const source = row(['NO_REQUIRED_ITEMS', 'NO_REQUIRED_ITEMS']);
    expect(matrixRowDeliveryStatus(source, milestones)).toBe(
      'NO_REQUIRED_ITEMS',
    );
    expect(
      applyMatrixQuickFilter([source], milestones, 'NO_REQUIRED_ITEMS'),
    ).toEqual([source]);
    expect(matrixPageStats([source], milestones)).toEqual({
      totalCells: 0,
      filledCells: 0,
      emptyCells: 0,
      lateCells: 0,
      noRequiredCells: 2,
    });
  });
  it('counts modern required submissions even without a legacy submission', () => {
    const source = row(['COMPLETE', 'MISSING']);
    const modernOnly = {
      ...source,
      cells: source.cells.map((cell) => ({
        ...cell,
        status: 'NOT_SUBMITTED' as const,
        submissionId: null,
      })),
    };
    expect(matrixPageStats([modernOnly], milestones)).toEqual({
      totalCells: 2,
      filledCells: 1,
      emptyCells: 1,
      lateCells: 0,
      noRequiredCells: 0,
    });
  });
  it('filters the visible milestone scope by server delivery status', () => {
    const source = row(['LATE', 'MISSING']);
    expect(
      applyMatrixQuickFilter([source], milestones.slice(0, 1), 'LATE'),
    ).toEqual([source]);
    expect(applyMatrixQuickFilter([source], milestones, 'LATE')).toEqual([]);
  });
});
