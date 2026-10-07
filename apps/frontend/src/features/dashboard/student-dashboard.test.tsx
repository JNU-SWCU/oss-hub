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
import type { StudentDashboard } from './types';

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

const firstItemOf = (data: StudentDashboard) => {
  const item = data.items[0];
  if (item === undefined) {
    throw new Error('카드가 하나 이상인 fixture가 필요합니다.');
  }
  return item;
};

describe('StudentDashboardView', () => {
  it('헤더에 내 활동 바로가기를 두지 않는다', () => {
    const html = renderView();
    const emptyHtml = renderView({ data: { items: [] } });

    expect(html).not.toContain('href="/dashboard/activity"');
    expect(emptyHtml).not.toContain('href="/dashboard/activity"');
  });

  it('모든 참여 카드가 현재 팀 이름을 말하고 개인형 표기를 남기지 않는다', () => {
    const html = renderView();

    expect(html).toContain('캡스톤 2026');
    expect(html).toContain('OSS 경진대회');
    for (const item of dashboardFixture.items) {
      expect(html).toContain(item.teamName);
    }

    expect(firstItemOf(dashboardFixture).teamName).toBe('합성 1인 팀');
    expect(html).not.toContain('개인');
    expect(html).not.toContain('PERSONAL');
    expect(html).toContain('>신청<');
    expect(html).toContain('미제출');
    expect(html).toContain('D-3');
    expect(html).toContain('7월 26일 23:59 마감');
  });

  it.each([
    ['참여', dashboardFixture],
    ['판정 전 신청', pendingDashboardFixture],
    ['반려', rejectedDashboardFixture],
    ['제출을 마친 신청', completedDashboardFixture],
  ] as const)('%s 카드도 팀 이름과 우리 팀 입구를 잃지 않는다', (_l, data) => {
    const item = firstItemOf(data);
    const html = renderView({ data });

    expect(html).toContain(item.teamName);
    expect(html).toContain('우리 팀');

    expect(item.teamUrl).toBe(`/programs/${item.programId}/my-team`);
    expect(html).toContain(`href="${item.teamUrl}"`);
  });

  it('카드 전체를 링크로 감싸거나 링크 안에 버튼을 중첩하지 않는다', () => {
    const html = renderView();

    expect(html).not.toMatch(/<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<a\s/);
  });

  it('승인 카드는 우리 팀과 제출 현황만 남기고 프로그램 개요 입구를 중복하지 않는다', () => {
    const item = firstItemOf(dashboardFixture);
    const html = renderView();

    expect(html).toContain('우리 팀');
    expect(html).toContain('제출 현황');
    expect(html).toContain(`href="${item.checklistUrl}"`);

    expect(html).not.toContain('프로그램 상세');
    expect(html).not.toContain(`href="/programs/${item.programId}"`);

    expect(item.checklistUrl).toBe(`/programs/${item.programId}/submissions`);
    expect(item.checklistUrl).not.toBe(item.teamUrl);
  });

  it('저장소 생성·초대 상태와 안전한 이동 링크를 제공한다', () => {
    const html = renderView();

    expect(html).not.toContain('href="/my-repos"');
    expect(html).toContain('준비 완료');
    expect(html).toContain('저장소 생성 중');
    expect(html).toContain(
      'href="https://github.com/JNU-SWCU/synthetic-capstone-repo"',
    );

    const firstItem = firstItemOf(dashboardFixture);
    if (!firstItem.repository) {
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
      'href="https://github.com/JNU-SWCU/synthetic-capstone-repo"',
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
      'href="https://github.com/JNU-SWCU/synthetic-capstone-repo"',
    );

    const ownRepositoryHtml = renderView({
      data: {
        items: [
          {
            ...firstItem,
            repository: {
              ...firstItem.repository,
              repositoryName: 'synthetic-repository',
              githubUrl:
                'https://github.com/synthetic-owner/synthetic-repository',
              invitationStatus: null,
            },
          },
        ],
      },
    });
    expect(ownRepositoryHtml).toContain('준비 완료');
    expect(ownRepositoryHtml).toContain(
      'href="https://github.com/synthetic-owner/synthetic-repository"',
    );
  });

  it('최종 저장소 생성 실패는 사용자에게 경고하고 재시도와 구분한다', () => {
    const firstItem = firstItemOf(dashboardFixture);
    if (!firstItem.repository) {
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

  it('판정 전 신청에는 제출 링크나 마일스톤을 노출하지 않는다', () => {
    const html = renderView({ data: pendingDashboardFixture });

    expect(html).toContain('>신청<');

    expect(html).toContain('승인되면 다음 일정이 표시됩니다.');
    expect(html).toContain('신청 상세');
    expect(html).not.toContain('제출 현황');
    expect(html).not.toContain(
      `href="${firstItemOf(pendingDashboardFixture).checklistUrl}"`,
    );
  });

  it('판정 전과 승인은 같은 「신청」을 달아도 할 수 있는 일이 다르다', () => {
    const pendingHtml = renderView({ data: pendingDashboardFixture });
    const approvedHtml = renderView({ data: dashboardFixture });

    expect(pendingHtml).toContain('>신청<');
    expect(approvedHtml).toContain('>신청<');
    expect(pendingHtml).not.toContain('>반려<');

    expect(pendingHtml).toContain('신청 상세');
    expect(pendingHtml).not.toContain('제출 현황');
    expect(pendingHtml).not.toContain('내 저장소');
    expect(approvedHtml).not.toContain('신청 상세');
    expect(approvedHtml).toContain('제출 현황');
    expect(approvedHtml).toContain('내 저장소');

    expect(approvedHtml).not.toContain('승인되면 다음 일정이 표시됩니다.');
  });

  it('예정된 제출 항목을 모두 마쳤습니다. 상태를 표시한다', () => {
    const html = renderView({ data: completedDashboardFixture });

    expect(html).toContain('예정된 제출 항목을 모두 마쳤습니다.');

    expect(html).toContain('>신청<');
    expect(html).not.toContain('>완료<');
    expect(html).not.toContain('>참여 중<');
    expect(html).not.toContain('다음 마일스톤');
  });

  it('반려 신청에는 신청 상세와 우리 팀만 남기고 제출 입구는 감춘다', () => {
    const html = renderView({ data: rejectedDashboardFixture });

    expect(html).toContain('>반려<');
    expect(html).not.toContain('>신청<');
    expect(html).toContain('신청이 반려되었습니다.');
    expect(html).toContain('신청 상세');
    expect(html).not.toContain('제출 현황');

    expect(html).toContain('우리 팀');

    expect(html).toContain('신청 상세에서 반려 사유를 확인해 주세요.');
    expect(html).not.toContain('프로그램 상세에서 신청 상태를 확인해 주세요.');
  });

  it.each([
    ['판정 전 신청', pendingDashboardFixture],
    ['반려', rejectedDashboardFixture],
  ] as const)(
    '%s 카드의 신청 상세는 응답이 준 신청서 화면으로 간다',
    (_label, data) => {
      const item = firstItemOf(data);

      const html = renderView({ data });

      expect(item.detailUrl).toBe(`/programs/${item.programId}/apply`);
      expect(html).toContain(`href="${item.detailUrl}"`);
      expect(html).not.toContain(`href="/programs/${item.programId}"`);
    },
  );

  it('공지에서 가져온 포스터 주소를 카드 이미지로 그대로 보여 준다', () => {
    const external =
      'https://sojoong.kr/wp-content/uploads/kboard_attached/1/209901/synthetic-poster.png';
    const html = renderView({
      data: {
        ...dashboardFixture,
        items: [{ ...firstItemOf(dashboardFixture), coverImageUrl: external }],
      },
    });

    expect(html).toContain(`src="${external}"`);
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
    const arrived = renderView({ showSignupCompleteNotice: true });
    const revisited = renderView();

    expect(arrived).toContain('가입이 완료되었습니다');
    expect(arrived).toContain(
      '프로그램을 신청하고 저장소를 연결할 수 있습니다',
    );

    expect(revisited).not.toContain('가입이 완료되었습니다');
  });

  it('완료 안내가 떠도 화면 제목은 그대로 "내 대시보드"다', () => {
    const arrived = renderView({ showSignupCompleteNotice: true });

    expect(arrived).toContain('내 대시보드');
    expect(arrived).toContain('신청한 프로그램과 다음 제출 일정을 확인합니다');
  });

  it('승인 알림은 판정 시각과 다음 제출 행동을 한 번의 배너로 안내한다', () => {
    const html = renderView({
      applicationDecisionNotices: [
        {
          id: 'notification-1',
          applicationId: 'application-1',
          programId: 'program-1',
          programName: '합성 프로그램',
          decision: 'APPROVED',
          decidedAt: '2026-08-08T23:00:00.000Z',
        },
      ],
    });

    expect(html).toContain('합성 프로그램 신청이 승인되었습니다');
    expect(html).toContain('다음 제출 일정과 준비할 내용을 확인해 주세요');
    expect(html).toContain('href="/programs/program-1/submissions"');
    expect(html).toContain('2026. 8. 9.');
  });

  it('반려 알림은 사유 원문 대신 사유가 있는 화면을 가리킨다', () => {
    const notice = {
      id: 'notification-2',
      applicationId: 'application-2',
      programId: 'program-2',
      programName: '합성 경진대회',
      decision: 'REJECTED',
      decidedAt: '2026-08-09T00:00:00.000Z',
    } as const;
    const html = renderView({ applicationDecisionNotices: [notice] });

    expect(html).toContain('합성 경진대회 신청이 반려되었습니다');
    expect(html).toContain('신청 상세에서 반려 사유를 확인해 주세요');

    expect(html).toContain('href="/programs/program-2/apply"');
    expect(html).toContain('반려 사유 확인');

    expect(html).not.toContain('신청 상세에서 상태를 확인해 주세요');

    const secret = '대시보드에 오면 안 되는 사유 원문';
    const htmlWithReason = renderView({
      applicationDecisionNotices: [
        { ...notice, rejectionReason: secret } as unknown as typeof notice,
      ],
    });
    expect(htmlWithReason).not.toContain(secret);
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
