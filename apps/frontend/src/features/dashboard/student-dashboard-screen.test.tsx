import { act } from 'react';
import {
  listNavigation,
  useTestSearchParams,
} from '../../../test-support/list-screen-root';
import { renderWithQuery } from '../../../test-support/render-with-query';
type Root = Awaited<ReturnType<typeof renderWithQuery>>;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardFixture, feedbackItemFixture } from './fixtures';
import type {
  ApplicationDecisionNotice,
  StudentDashboard,
  TeamDeletionNotice,
  StudentDashboardStatus,
  StudentFeedbackState,
} from './types';

vi.mock('next/navigation', () => ({
  useSearchParams: useTestSearchParams,
  useRouter: () => listNavigation,
  usePathname: () => '/dashboard',
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  fetchUnreadTeamDeletionNotices: vi.fn(),
  markTeamDeletionNoticeRead: vi.fn(),
  fetchStudentFeedback: vi.fn(),
  fetchUnreadApplicationDecisionNotices: vi.fn(),
  markApplicationDecisionNoticeRead: vi.fn(),
  fetchStudentDashboard: vi.fn(),
  consumeSignupCompletionNotice: vi.fn(),
}));

vi.mock('./team-deletion-notices-api', () => ({
  fetchUnreadTeamDeletionNotices: mocks.fetchUnreadTeamDeletionNotices,
  markTeamDeletionNoticeRead: mocks.markTeamDeletionNoticeRead,
}));

vi.mock('./api', () => ({
  fetchStudentDashboard: mocks.fetchStudentDashboard,
  fetchStudentFeedback: mocks.fetchStudentFeedback,
  fetchUnreadApplicationDecisionNotices:
    mocks.fetchUnreadApplicationDecisionNotices,
  markApplicationDecisionNoticeRead: mocks.markApplicationDecisionNoticeRead,
}));
vi.mock('@/lib/signup-completion-notice', () => ({
  consumeSignupCompletionNotice: mocks.consumeSignupCompletionNotice,
}));

type CapturedViewProps = {
  readonly teamDeletionNotices: readonly TeamDeletionNotice[];
  readonly onReadTeamDeletion: (id: string) => void;
  readonly data: StudentDashboard | null;
  readonly status: StudentDashboardStatus;
  readonly applicationDecisionNotices: readonly ApplicationDecisionNotice[];
  readonly feedback: StudentFeedbackState;
  readonly onRetryFeedback: () => void;
  readonly onRetry: () => void;
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

  beforeEach(async () => {
    root = await renderWithQuery(null);
    container = root.container;
    captured.props = null;
    mocks.consumeSignupCompletionNotice.mockReset().mockReturnValue(false);
    mocks.fetchStudentDashboard.mockReset().mockResolvedValue({ items: [] });
    mocks.fetchUnreadApplicationDecisionNotices
      .mockReset()
      .mockResolvedValue([notice]);
    mocks.fetchUnreadTeamDeletionNotices.mockReset().mockResolvedValue([]);
    mocks.markTeamDeletionNoticeRead.mockReset().mockResolvedValue(undefined);
    mocks.fetchStudentFeedback.mockReset().mockResolvedValue([]);
    mocks.markApplicationDecisionNoticeRead
      .mockReset()
      .mockImplementation(async () => {
        everyAcknowledgementSawRenderedNotice &&=
          captured.props?.applicationDecisionNotices[0]?.id === notice.id;
      });
    everyAcknowledgementSawRenderedNotice = true;
  });

  it('keeps team deletion notices unread until the user acknowledges the selected notice', async () => {
    const deleted = {
      id: 'deleted-notice',
      teamId: 'team',
      teamName: '합성 팀',
      programId: 'program',
      programName: '합성 프로그램',
      message: null,
      deletedAt: '2026-08-09T00:00:00.000Z',
    };
    mocks.fetchUnreadTeamDeletionNotices
      .mockResolvedValueOnce([deleted])
      .mockResolvedValue([]);
    await act(async () => root.render(<StudentDashboardScreen />));
    expect(captured.props?.teamDeletionNotices).toEqual([deleted]);
    expect(mocks.markTeamDeletionNoticeRead).not.toHaveBeenCalled();

    await act(async () => captured.props?.onReadTeamDeletion(deleted.id));

    expect(mocks.markTeamDeletionNoticeRead).toHaveBeenCalledWith(deleted.id);
    expect(captured.props?.teamDeletionNotices).toEqual([]);
  });

  afterEach(async () => {
    await root.unmount();
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

  it.each([new TypeError('network'), 'unexpected'])(
    '대시보드 조회 실패 후 재시도하면 서버 데이터를 표시한다: %s',
    async (error) => {
      mocks.fetchStudentDashboard
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(dashboardFixture);
      await act(async () => root.render(<StudentDashboardScreen />));
      expect(captured.props?.status).toBe('error');
      await act(async () => captured.props?.onRetry());
      expect(captured.props?.status).toBe('success');
      expect(captured.props?.data).toEqual(dashboardFixture);
      expect(mocks.fetchStudentDashboard).toHaveBeenCalledTimes(2);
    },
  );

  it('최근 피드백 실패는 대시보드 카드 상태를 건드리지 않고 피드백만 다시 부른다', async () => {
    mocks.fetchStudentDashboard.mockResolvedValue(dashboardFixture);
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
    expect(mocks.fetchStudentDashboard).toHaveBeenCalledTimes(1);
  });
});
