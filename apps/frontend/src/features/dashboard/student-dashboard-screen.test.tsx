// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApplicationDecisionNotice,
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

type CapturedViewProps = {
  readonly data: StudentDashboard | null;
  readonly status: StudentDashboardStatus;
  readonly applicationDecisionNotices: readonly ApplicationDecisionNotice[];
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
