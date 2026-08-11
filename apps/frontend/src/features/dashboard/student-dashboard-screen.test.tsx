// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApplicationDecisionNotice,
  PendingTeamInviteView,
  StudentDashboard,
  StudentDashboardStatus,
} from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  fetchUnreadApplicationDecisionNotices: vi.fn(),
  markApplicationDecisionNoticeRead: vi.fn(),
  loadStudentDashboard: vi.fn(),
  consumeSignupCompletionNotice: vi.fn(),
  fetchPendingTeamInviteViews: vi.fn(),
  acceptTeamInvitation: vi.fn(),
  declineTeamInvitation: vi.fn(),
}));

vi.mock('./api', () => ({
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
vi.mock('./team-invitations-api', () => ({
  fetchPendingTeamInviteViews: mocks.fetchPendingTeamInviteViews,
  acceptTeamInvitation: mocks.acceptTeamInvitation,
  declineTeamInvitation: mocks.declineTeamInvitation,
}));

type CapturedViewProps = {
  readonly data: StudentDashboard | null;
  readonly status: StudentDashboardStatus;
  readonly applicationDecisionNotices: readonly ApplicationDecisionNotice[];
  readonly pendingTeamInvites: readonly PendingTeamInviteView[];
  readonly respondingInvitationId: string | null;
  readonly inviteActionError: string | null;
  readonly onAcceptInvite: (invitationId: string) => void;
  readonly onDeclineInvite: (invitationId: string) => void;
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

describe('StudentDashboardScreen application decision notices', () => {
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
    mocks.markApplicationDecisionNoticeRead
      .mockReset()
      .mockImplementation(async () => {
        everyAcknowledgementSawRenderedNotice &&=
          captured.props?.applicationDecisionNotices[0]?.id === notice.id;
      });
    mocks.fetchPendingTeamInviteViews.mockReset().mockResolvedValue([]);
    mocks.acceptTeamInvitation.mockReset();
    mocks.declineTeamInvitation.mockReset();
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
});

describe('StudentDashboardScreen pending team invites', () => {
  let container: HTMLDivElement;
  let root: Root;

  const invite: PendingTeamInviteView = {
    invitationId: 'invitation-1',
    teamId: 'team-1',
    programId: 'program-1',
    programName: '캡스톤 2026',
    teamName: '오픈소스팀',
  };

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
      .mockResolvedValue([]);
    mocks.markApplicationDecisionNoticeRead
      .mockReset()
      .mockResolvedValue(undefined);
    mocks.fetchPendingTeamInviteViews.mockReset();
    mocks.acceptTeamInvitation.mockReset();
    mocks.declineTeamInvitation.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('조회에 실패해도 대시보드 나머지는 정상 렌더한다', async () => {
    mocks.fetchPendingTeamInviteViews.mockRejectedValue(
      new Error('synthetic network failure'),
    );

    await act(async () => root.render(<StudentDashboardScreen />));

    expect(captured.props?.pendingTeamInvites).toEqual([]);
    expect(captured.props?.status).toBe('success');
  });

  it('받은 초대를 화면에 전달한다', async () => {
    mocks.fetchPendingTeamInviteViews.mockResolvedValue([invite]);

    await act(async () => root.render(<StudentDashboardScreen />));

    expect(captured.props?.pendingTeamInvites).toEqual([invite]);
  });

  it('수락에 성공하면 목록에서 제거하고 마지막 건이면 배너가 사라진다', async () => {
    mocks.fetchPendingTeamInviteViews.mockResolvedValue([invite]);
    mocks.acceptTeamInvitation.mockResolvedValue(undefined);

    await act(async () => root.render(<StudentDashboardScreen />));
    expect(captured.props?.pendingTeamInvites).toEqual([invite]);

    await act(async () => {
      captured.props?.onAcceptInvite(invite.invitationId);
    });

    expect(mocks.acceptTeamInvitation).toHaveBeenCalledWith(
      invite.invitationId,
    );
    expect(captured.props?.pendingTeamInvites).toEqual([]);
    expect(captured.props?.respondingInvitationId).toBeNull();
  });

  it('거절이 실패하면 국소 오류를 노출하고 목록은 그대로 둔다', async () => {
    mocks.fetchPendingTeamInviteViews.mockResolvedValue([invite]);
    mocks.declineTeamInvitation.mockRejectedValue(
      new Error('synthetic network failure'),
    );

    await act(async () => root.render(<StudentDashboardScreen />));

    await act(async () => {
      captured.props?.onDeclineInvite(invite.invitationId);
    });

    expect(captured.props?.pendingTeamInvites).toEqual([invite]);
    expect(captured.props?.inviteActionError).toBe('초대 거절에 실패했습니다.');
  });
});
