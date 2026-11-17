import { describe, expect, it } from 'vitest';
import {
  applyMatrixQuickFilter,
  matrixCellAction,
  matrixPageStats,
  matrixRowAction,
} from './matrix';
import type { MatrixCell, MatrixRow } from './types';

const milestones = [
  { id: 'first', name: '1차', dueAt: '2026-08-01T00:00:00Z' },
  { id: 'second', name: '2차', dueAt: '2026-08-01T00:00:00Z' },
];
const NOW = new Date('2026-09-02T00:00:00Z');
function row(
  statuses: readonly ('MISSING' | 'LATE' | 'COMPLETE' | 'NO_REQUIRED_ITEMS')[],
): MatrixRow {
  return {
    teamId: 'application',
    applicationMode: 'TEAM',
    displayName: '합성팀',
    githubLogins: [],
    cells: statuses.map((deliveryStatus, index): MatrixCell => ({
      milestoneId: index === 0 ? 'first' : 'second',
      submissionId: 'submission',
      revision: 2,
      status: 'APPROVED',
      submittedAt: '2026-09-01T00:00:00Z',
      changesRequestedCount: 0,
      deliveryStatus,
    })),
  };
}

describe('delivery status in matrix actions', () => {
  it('uses first-submission server status even when a revision was submitted late', () => {
    const [cell] = row(['COMPLETE']).cells;
    const [milestone] = milestones;
    if (cell === undefined || milestone === undefined)
      throw new TypeError('Missing fixture');
    expect(matrixCellAction(cell, milestone, NOW).late).toBe(false);
  });
  it('gives an overdue missing document precedence over a late approval', () => {
    expect(matrixRowAction(row(['LATE', 'MISSING']), milestones, NOW)).toBe(
      'OVERDUE',
    );
  });
  it('keeps the review decision when the other stage has no required documents', () => {
    expect(
      matrixRowAction(row(['COMPLETE', 'NO_REQUIRED_ITEMS']), milestones, NOW),
    ).toBe('APPROVED');
  });
  it('keeps optional submissions as their review decision', () => {
    const source = row(['NO_REQUIRED_ITEMS', 'NO_REQUIRED_ITEMS']);
    expect(matrixRowAction(source, milestones, NOW)).toBe('APPROVED');
    expect(
      applyMatrixQuickFilter([source], milestones, 'APPROVED', NOW),
    ).toEqual([source]);
  });
  it('shows no status for stages without required documents or submissions', () => {
    const source = row(['NO_REQUIRED_ITEMS', 'NO_REQUIRED_ITEMS']);
    const unsubmitted = {
      ...source,
      cells: source.cells.map((cell) => ({
        ...cell,
        status: 'NOT_SUBMITTED' as const,
        submissionId: null,
      })),
    };
    expect(matrixRowAction(unsubmitted, milestones, NOW)).toBe('NONE');
    expect(matrixPageStats([unsubmitted], milestones, NOW).NONE).toBe(2);
  });
  it('filters the visible milestone scope by row action', () => {
    const source = row(['LATE', 'MISSING']);
    expect(
      applyMatrixQuickFilter([source], milestones.slice(0, 1), 'APPROVED', NOW),
    ).toEqual([source]);
    expect(
      applyMatrixQuickFilter([source], milestones, 'APPROVED', NOW),
    ).toEqual([]);
  });
});
