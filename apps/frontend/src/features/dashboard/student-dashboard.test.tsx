// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudentDashboardScreen } from './components/student-dashboard-screen';
import { StudentDashboardView } from './components/student-dashboard-view';
import {
  completedDashboardFixture,
  dashboardFixture,
  pendingDashboardFixture,
  rejectedDashboardFixture,
} from './fixtures';

const { fetchStudentDashboardMock } = vi.hoisted(() => ({
  fetchStudentDashboardMock: vi.fn(),
}));

vi.mock('./api', () => ({
  fetchStudentDashboard: fetchStudentDashboardMock,
}));

afterEach(() => {
  cleanup();
  fetchStudentDashboardMock.mockReset();
});

const renderView = (
  props: Partial<Parameters<typeof StudentDashboardView>[0]> = {},
) =>
  renderToStaticMarkup(
    <StudentDashboardView
      data={dashboardFixture}
      status="success"
      now={new Date('2026-07-23T10:00:00+09:00')}
      onRetry={() => undefined}
      {...props}
    />,
  );

describe('StudentDashboardView', () => {
  it('개인형과 팀형 참여 카드를 구분하고 다음 제출 상태를 표시한다', () => {
    const html = renderView();

    expect(html).toContain('캡스톤 2026');
    expect(html).toContain('개인');
    expect(html).toContain('OSS 경진대회');
    expect(html).toContain('팀');
    expect(html).toContain('참여 중');
    expect(html).toContain('미제출');
    expect(html).toContain('D-3');
    expect(html).toContain('프로그램 상세');
    expect(html).toContain('제출 체크리스트');
  });

  it('승인 대기 신청에는 제출 링크나 마일스톤을 노출하지 않는다', () => {
    const html = renderView({ data: pendingDashboardFixture });

    expect(html).toContain('승인 대기');
    expect(html).toContain('신청 검토 후 일정이 열립니다.');
    expect(html).toContain('신청 상세');
    expect(html).not.toContain('제출 체크리스트');
  });

  it('모든 마일스톤 완료 상태를 표시한다', () => {
    const html = renderView({ data: completedDashboardFixture });

    expect(html).toContain('모든 마일스톤 완료');
    expect(html).toContain('>완료<');
    expect(html).not.toContain('>참여 중<');
    expect(html).not.toContain('다음 마일스톤');
  });

  it('반려 신청에는 신청 상세만 표시한다', () => {
    const html = renderView({ data: rejectedDashboardFixture });

    expect(html).toContain('신청 반려');
    expect(html).toContain('신청이 반려되었습니다.');
    expect(html).toContain('신청 상세');
    expect(html).not.toContain('제출 체크리스트');
  });

  it('신청이 없으면 프로그램 목록 이동을 제공한다', () => {
    const html = renderView({ data: { items: [] } });

    expect(html).toContain('아직 신청한 프로그램이 없습니다');
    expect(html).toContain('프로그램 둘러보기');
    expect(html).toContain('href="/programs"');
  });

  it('조회 실패와 다시 시도를 함께 표시한다', () => {
    const onRetry = vi.fn();
    const html = renderView({
      data: null,
      status: 'error',
      onRetry,
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('대시보드를 불러오지 못했습니다');
    expect(html).toContain('다시 시도');
  });

  it('조회 실패 후 다시 시도를 누르면 대시보드를 다시 요청한다', async () => {
    fetchStudentDashboardMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(dashboardFixture);

    render(<StudentDashboardScreen />);

    expect(
      await screen.findByText('대시보드를 불러오지 못했습니다'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    await waitFor(() => {
      expect(fetchStudentDashboardMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('캡스톤 2026')).toBeTruthy();
  });

  it('로딩 중에는 접근 가능한 로딩 상태를 표시한다', () => {
    const html = renderView({ data: null, status: 'loading' });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('대시보드를 불러오는 중');
  });
});
