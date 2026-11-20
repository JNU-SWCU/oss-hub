import { Window } from 'happy-dom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MatrixCellContent } from './components/submission-matrix-cell';
import { SubmissionMatrixView } from './components/submission-matrix-view';
import { MATRIX_DEFAULT_ORDER } from './matrix';
import type {
  MatrixCell,
  MatrixMilestone,
  SubmissionMatrixPage,
} from './types';

const now = new Date('2026-11-19T03:00:00Z');
const report: MatrixMilestone = {
  id: 'report',
  name: '최종 보고',
  dueAt: '2026-12-19T14:59:59Z',
};
const approved: MatrixCell = {
  milestoneId: report.id,
  status: 'APPROVED',
  submissionId: 'approved-report',
  revision: 2,
  deliveryStatus: 'COMPLETE',
  submittedAt: '2026-11-15T13:41:00Z',
  changesRequestedCount: 0,
};
const result: SubmissionMatrixPage = {
  milestones: [
    { id: 'plan', name: '계획서', dueAt: '2026-10-02T14:59:59Z' },
    report,
  ],
  rows: [
    {
      teamId: 'team-21',
      applicationMode: 'TEAM',
      displayName: '알파 팀',
      leaderName: '김하늘',
      githubLogins: [],
      cells: [
        {
          ...approved,
          milestoneId: 'plan',
          status: 'REJECTED',
          submissionId: null,
          revision: null,
          submittedAt: null,
        },
        approved,
      ],
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  statusCounts: {
    NOT_SUBMITTED: 57,
    SUBMITTED: 2,
    CHANGES_REQUESTED: 1,
    REJECTED: 1,
    APPROVED: 2,
  },
};

describe('matrix delivery data under a server status filter', () => {
  it('shows both milestone icons for the matching team and keeps counts from outside the page', () => {
    const window = new Window();
    try {
      window.document.body.innerHTML = renderToStaticMarkup(
        createElement(SubmissionMatrixView, {
          programId: 'program-1',
          data: result,
          search: '',
          filterActive: false,
          status: 'REJECTED',
          ...MATRIX_DEFAULT_ORDER,
          isLoading: false,
          errorMessage: null,
          now,
          onSearchChange: vi.fn(),
          onSearch: vi.fn(),
          onStatusChange: vi.fn(),
          onSort: vi.fn(),
          onResetFilters: vi.fn(),
          onPageChange: vi.fn(),
          onRetry: vi.fn(),
        }),
      );
      const { document } = window;
      const row = document.querySelector('table tbody tr');
      const cells = row?.querySelectorAll('td');
      expect(row?.textContent).toContain('팀장 김하늘');
      expect(cells?.[0]?.textContent).toBe('반려');
      expect(cells?.[1]?.textContent).toBe('승인');
      expect(
        cells?.[1]?.querySelector('svg.lucide-circle-check'),
      ).not.toBeNull();

      const filters = document.querySelector(
        '[role="group"][aria-label="제출 상태 필터"]',
      );
      expect(
        filters?.querySelector('button[aria-pressed="true"]')?.textContent,
      ).toBe('반려 1');
      expect(filters?.textContent).toContain('전체 63');
      expect(filters?.textContent).toContain('승인 2');
      expect(
        document.querySelector('[aria-label="제출 현황 페이지"]'),
      ).toBeNull();
    } finally {
      window.close();
    }
  });

  it('keeps the approved document deadline, submission time, version, and review link in stage details', () => {
    const details = renderToStaticMarkup(
      createElement(MatrixCellContent, {
        programId: 'program-1',
        cell: approved,
        milestone: report,
        now,
        showSubmission: true,
      }),
    );

    expect(details).toContain('12.19 (토) 마감');
    expect(details).toContain('11.15 22:41 제출 · v2');
    expect(details).toContain(
      'href="/programs/program-1/submissions/approved-report/review"',
    );
  });
});
