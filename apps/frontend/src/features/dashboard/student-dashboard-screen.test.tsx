import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardFixture, feedbackItemFixture } from './fixtures';
import type {
  ApplicationDecisionNotice,
  StudentDashboard,
  StudentDashboardStatus,
  StudentFeedbackState,
} from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  fetchStudentFeedback: vi.fn(),
  fetchUnreadApplicationDecisionNotices: vi.fn(),
  markApplicationDecisionNoticeRead: vi.fn(),
  loadStudentDashboard: vi.fn(),
  consumeSignupCompletionNotice: vi.fn(),
}));

vi.mock('./api', () => ({
  fetchStudentFeedback: mocks.fetchStudentFeedback,
  fetchUnreadApplicationDecisionNotices:
    mocks.fetchUnreadApplicationDecisionNotices,
  markApplicationDecisionNoticeRead: mocks.markApplicationDecisionNoticeRead,
}));
vi.mock('./load-student-dashboard', () => ({
  loadStudentDashboard: mocks.loadStudentDashboard,
}));
vi.mock('@/lib/signup-completion-notice', () => ({
  consumeSignupCompletionNotice: mocks.consumeSignupCompletionNotice,
}));

type CapturedViewProps = {
  readonly data: StudentDashboard | null;
  readonly status: StudentDashboardStatus;
  readonly applicationDecisionNotices: readonly ApplicationDecisionNotice[];
  readonly feedback: StudentFeedbackState;
  readonly onRetryFeedback: () => void;
};
const captured = vi.hoisted(() => ({
  props: null as CapturedViewProps | null,
}));
vi.mock('./components/student-dashboard-view', () => ({
  StudentDashboardView: (props: CapturedViewProps) => {
    captured.props = props;
    return null;
  },
}));

import { StudentDashboardScreen } from './components/student-dashboard-screen';

const notice: ApplicationDecisionNotice = {
  id: 'notification-1',
  applicationId: 'application-1',
  programId: 'program-1',
  programName: '합성 프로그램',
  decision: 'APPROVED',
  decidedAt: '2026-08-09T00:00:00.000Z',
};

let everyAcknowledgementSawRenderedNotice = true;

describe('StudentDashboardScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    captured.props = null;
    mocks.consumeSignupCompletionNotice.mockReset().mockReturnValue(false);
    mocks.loadStudentDashboard
      .mockReset()
      .mockResolvedValue({ status: 'success', data: { items: [] } });
    mocks.fetchUnreadApplicationDecisionNotices
      .mockReset()
      .mockResolvedValue([notice]);
    mocks.fetchStudentFeedback.mockReset().mockResolvedValue([]);
    mocks.markApplicationDecisionNoticeRead
      .mockReset()
      .mockImplementation(async () => {
        everyAcknowledgementSawRenderedNotice &&=
          captured.props?.applicationDecisionNotices[0]?.id === notice.id;
      });
    everyAcknowledgementSawRenderedNotice = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows persisted notices before marking them read', async () => {
    await act(async () => root.render(<StudentDashboardScreen />));

    expect(captured.props?.applicationDecisionNotices).toEqual([notice]);
    expect(mocks.markApplicationDecisionNoticeRead).toHaveBeenCalledWith(
      notice.id,
    );
    expect(everyAcknowledgementSawRenderedNotice).toBe(true);
  });

  it('keeps the current banner visible when read acknowledgement fails', async () => {
    mocks.markApplicationDecisionNoticeRead.mockRejectedValue(
      new Error('synthetic network failure'),
    );

    await act(async () => root.render(<StudentDashboardScreen />));

    expect(captured.props?.applicationDecisionNotices).toEqual([notice]);
  });

  it('최근 피드백 실패는 대시보드 카드 상태를 건드리지 않고 피드백만 다시 부른다', async () => {
    mocks.loadStudentDashboard.mockResolvedValue({
      status: 'success',
      data: dashboardFixture,
    });
    mocks.fetchStudentFeedback
      .mockRejectedValueOnce(new Error('synthetic feedback failure'))
      .mockResolvedValueOnce([feedbackItemFixture]);

    await act(() => {
      root.render(<StudentDashboardScreen />);
      return Promise.resolve();
    });

    expect(captured.props?.status).toBe('success');
    expect(captured.props?.data).toEqual(dashboardFixture);
    expect(captured.props?.feedback).toEqual({ status: 'error' });

    await act(() => {
      captured.props?.onRetryFeedback();
      return Promise.resolve();
    });

    expect(captured.props?.feedback).toEqual({
      status: 'success',
      items: [feedbackItemFixture],
    });
    expect(captured.props?.data).toEqual(dashboardFixture);
    expect(mocks.fetchStudentFeedback).toHaveBeenCalledTimes(2);
    expect(mocks.loadStudentDashboard).toHaveBeenCalledTimes(1);
  });
});
