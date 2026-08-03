import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { StudentDashboardView } from './components/student-dashboard-view';
import {
  completedDashboardFixture,
  dashboardFixture,
  pendingDashboardFixture,
  rejectedDashboardFixture,
} from './fixtures';
import { loadStudentDashboard } from './load-student-dashboard';

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
  it('학생 대시보드에서 내 활동 이동 링크를 제공한다', () => {
    // Given
    const expectedActivityLink =
      /<a\b[^>]*href="\/dashboard\/activity"[\s\S]*내 활동[\s\S]*<\/a>/;

    // When
    const html = renderView();
    const emptyHtml = renderView({ data: { items: [] } });

    // Then
    expect(html).toMatch(expectedActivityLink);
    expect(emptyHtml).toMatch(expectedActivityLink);
  });

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

  it('저장소 생성·초대 상태와 안전한 이동 링크를 제공한다', () => {
    // Given: 참여 프로그램이 있는 학생 대시보드

    // When
    const html = renderView();

    // Then
    expect(html).not.toContain('href="/my-repos"');
    expect(html).toContain('준비 완료');
    expect(html).toContain('저장소 생성 중');
    expect(html).toContain('href="https://github.com/JNU-SWCU/capstone-hong"');

    const firstItem = dashboardFixture.items[0];
    if (!firstItem?.repository) {
      throw new Error('저장소가 포함된 대시보드 fixture가 필요합니다.');
    }
    const invitationPendingHtml = renderView({
      data: {
        items: [
          {
            ...firstItem,
            repository: {
              ...firstItem.repository,
              invitationStatus: 'PENDING',
            },
          },
        ],
      },
    });
    expect(invitationPendingHtml).toContain('초대 수락 대기');
    expect(invitationPendingHtml).not.toContain(
      'href="https://github.com/JNU-SWCU/capstone-hong"',
    );

    const invitationFailedHtml = renderView({
      data: {
        items: [
          {
            ...firstItem,
            repository: {
              ...firstItem.repository,
              invitationStatus: 'FAILED_FINAL',
            },
          },
        ],
      },
    });
    expect(invitationFailedHtml).toContain('초대 확인 필요');
    expect(invitationFailedHtml).not.toContain(
      'href="https://github.com/JNU-SWCU/capstone-hong"',
    );
  });
  it('최종 저장소 생성 실패는 사용자에게 경고하고 재시도와 구분한다', () => {
    const firstItem = dashboardFixture.items[0];
    if (!firstItem?.repository) {
      throw new Error('저장소가 포함된 대시보드 fixture가 필요합니다.');
    }

    const finalFailureHtml = renderView({
      data: {
        items: [
          {
            ...firstItem,
            repository: {
              ...firstItem.repository,
              provisionStatus: 'FAILED_FINAL',
            },
          },
        ],
      },
    });
    const retryableFailureHtml = renderView({
      data: {
        items: [
          {
            ...firstItem,
            repository: {
              ...firstItem.repository,
              provisionStatus: 'FAILED_RETRYABLE',
            },
          },
        ],
      },
    });

    expect(finalFailureHtml).toContain('role="alert"');
    expect(finalFailureHtml).toContain('저장소 생성에 실패했습니다.');
    expect(finalFailureHtml).toContain('저장소 확인 필요');
    expect(retryableFailureHtml).toContain('저장소 생성 재시도 중');
    expect(retryableFailureHtml).not.toContain('저장소 생성에 실패했습니다.');
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
    const html = renderView({
      data: null,
      status: 'error',
      onRetry: () => undefined,
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('대시보드를 불러오지 못했습니다');
    expect(html).toContain('다시 시도');
  });

  it('로딩 중에는 접근 가능한 로딩 상태를 표시한다', () => {
    const html = renderView({ data: null, status: 'loading' });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('대시보드를 불러오는 중');
  });

  it('가입을 막 마치고 도착했을 때만 완료 안내를 표시한다', () => {
    // When
    const arrived = renderView({ showSignupCompleteNotice: true });
    const revisited = renderView();

    // Then
    expect(arrived).toContain('가입이 완료되었습니다');
    expect(arrived).toContain(
      '프로그램을 신청하고 저장소를 연결할 수 있습니다',
    );
    // 다시 온 사용자(새로고침·재접속·뒤로가기)에게는 흔적도 남지 않는다
    expect(revisited).not.toContain('가입이 완료되었습니다');
  });

  it('완료 안내가 떠도 화면 제목은 그대로 "내 대시보드"다', () => {
    // Given: 제목을 축하 문구로 바꾸면 3년 뒤 재방문자도 그 문구를 보게 된다
    const arrived = renderView({ showSignupCompleteNotice: true });

    expect(arrived).toContain('내 대시보드');
    expect(arrived).toContain('신청한 프로그램과 다음 제출 일정을 확인합니다');
  });
});

describe('loadStudentDashboard', () => {
  it('실패 후 다시 호출하면 성공 결과를 받는다', async () => {
    const fetchDashboard = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(dashboardFixture);

    await expect(loadStudentDashboard(fetchDashboard)).resolves.toEqual({
      status: 'error',
    });
    await expect(loadStudentDashboard(fetchDashboard)).resolves.toEqual({
      status: 'success',
      data: dashboardFixture,
    });
    expect(fetchDashboard).toHaveBeenCalledTimes(2);
  });

  it('Error가 아닌 예외도 오류 결과로 정규화한다', async () => {
    const fetchDashboard = vi.fn().mockRejectedValue('unexpected');

    await expect(loadStudentDashboard(fetchDashboard)).resolves.toEqual({
      status: 'error',
    });
  });
});
