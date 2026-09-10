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
    // 네비는 상단 waypoint + 좌측 사이드 패널로 충분하다.
    // 내 활동은 사이드 메뉴 항목이지 본문 PageHeader CTA가 아니다.
    const html = renderView();
    const emptyHtml = renderView({ data: { items: [] } });

    expect(html).not.toContain('href="/dashboard/activity"');
    expect(emptyHtml).not.toContain('href="/dashboard/activity"');
  });

  /**
   * 대시보드 항목은 전부 **지금 소속된 팀**이다(#1269). 혼자 참여한 항목도 팀이므로
   * 카드가 "개인"으로 갈라 사람 이름을 그리면 같은 자리에 두 가지 정체성이 생긴다.
   */
  it('모든 참여 카드가 현재 팀 이름을 말하고 개인형 표기를 남기지 않는다', () => {
    const html = renderView();

    expect(html).toContain('캡스톤 2026');
    expect(html).toContain('OSS 경진대회');
    for (const item of dashboardFixture.items) {
      expect(html).toContain(item.teamName);
    }
    // 1인 팀도 팀 이름으로 말한다 — 그 카드가 팀 이름을 갖고 있어야 이 단언이 의미 있다.
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
    // 응답이 준 주소를 그대로 쓰되, 그 값이 팀 화면 경로인지도 함께 고정한다.
    expect(item.teamUrl).toBe(`/programs/${item.programId}/my-team`);
    expect(html).toContain(`href="${item.teamUrl}"`);
  });

  /**
   * 카드 전체를 링크로 감싸고 그 안에 버튼을 넣으면 중첩 대화형 요소가 되어 키보드와
   * 스크린 리더의 이동 순서가 무너진다. 입구는 카드 표면이 아니라 명시적 CTA다.
   */
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
    // 개요는 우리 팀 화면과 프로그램 좌측 패널이 이미 이고 있다.
    expect(html).not.toContain('프로그램 상세');
    expect(html).not.toContain(`href="/programs/${item.programId}"`);
    // 제출 현황과 우리 팀은 서로 다른 화면이다 — 라벨만 바뀐 같은 주소가 아니다.
    expect(item.checklistUrl).toBe(`/programs/${item.programId}/submissions`);
    expect(item.checklistUrl).not.toBe(item.teamUrl);
  });

  it('저장소 생성·초대 상태와 안전한 이동 링크를 제공한다', () => {
    // Given: 참여 프로그램이 있는 학생 대시보드

    // When
    const html = renderView();

    // Then
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
    // 말은 승인된 신청과 같으니, 왜 지금은 제출할 수 없는지를 본문이 말해야 한다.
    expect(html).toContain('승인되면 다음 일정이 표시됩니다.');
    expect(html).toContain('신청 상세');
    expect(html).not.toContain('제출 현황');
    expect(html).not.toContain(
      `href="${firstItemOf(pendingDashboardFixture).checklistUrl}"`,
    );
  });

  /**
   * 학생이 보는 신청 상태 말은 「신청」과 「반려」 둘뿐이다. 다만 말을 합치는 것과
   * 할 수 있는 일을 합치는 것은 다른 문제다 — 판정 전과 승인은 여전히 서로 다른
   * 입구를 갖고, 그 차이를 카드 본문이 문장으로 설명한다.
   */
  it('판정 전과 승인은 같은 「신청」을 달아도 할 수 있는 일이 다르다', () => {
    const pendingHtml = renderView({ data: pendingDashboardFixture });
    const approvedHtml = renderView({ data: dashboardFixture });

    // 같은 말
    expect(pendingHtml).toContain('>신청<');
    expect(approvedHtml).toContain('>신청<');
    expect(pendingHtml).not.toContain('>반려<');

    // 다른 능력 — 판정 전에는 제출도 저장소도 없고 신청서만 열린다.
    expect(pendingHtml).toContain('신청 상세');
    expect(pendingHtml).not.toContain('제출 현황');
    expect(pendingHtml).not.toContain('내 저장소');
    expect(approvedHtml).not.toContain('신청 상세');
    expect(approvedHtml).toContain('제출 현황');
    expect(approvedHtml).toContain('내 저장소');
    // 승인된 신청에는 제출을 막는 설명이 붙지 않는다.
    expect(approvedHtml).not.toContain('승인되면 다음 일정이 표시됩니다.');
  });

  it('예정된 제출 항목을 모두 마쳤습니다. 상태를 표시한다', () => {
    const html = renderView({ data: completedDashboardFixture });

    expect(html).toContain('예정된 제출 항목을 모두 마쳤습니다.');
    // 마지막 제출까지 끝내도 신청은 여전히 승인된 신청이다 — 세 번째 말을 만들지 않는다.
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
    // 신청이 반려돼도 팀은 남는다 — 팀 화면으로 가는 길까지 끊지 않는다.
    expect(html).toContain('우리 팀');
    // 카드가 약속하는 것과 목적지가 같아야 한다. 예전 문구는 "프로그램 상세에서 신청
    // 상태를"이었는데 그 화면에는 신청 상태도 사유도 없었다(#733).
    expect(html).toContain('신청 상세에서 반려 사유를 확인해 주세요.');
    expect(html).not.toContain('프로그램 상세에서 신청 상태를 확인해 주세요.');
  });

  /**
   * 카드의 「신청 상세」 버튼이 **어디로 가는지**. 이 값을 확인하는 테스트가 하나도 없어,
   * 반려 카드가 사유 없는 프로그램 상세를 가리키는 동안에도 전부 초록불이었다(#733).
   *
   * href는 응답이 준 `detailUrl`을 **그대로** 써야 한다. 화면이 자기 규칙으로 주소를 다시
   * 만들면 서버는 계속 틀린 값을 내보내고, 같은 값을 읽는 알림·다른 화면이 똑같이 어긋난다.
   * 그래서 문자열을 박지 않고 픽스처가 실은 값과 대조한다 — 다만 그 값 자체가 신청서
   * 화면인지도 함께 고정해야, 픽스처가 옛 주소로 돌아가면 여기서 걸린다.
   */
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

  /**
   * 반려 알림은 **사유 원문을 싣지 않고**, 사유가 실제로 있는 곳을 가리킨다(#722).
   *
   * 예전 문구는 "신청 상세에서 상태를 확인해 주세요"였는데, 눌러 가면 도착하는
   * `/programs/{id}/apply`가 "수정하거나 취소할 수 없습니다"만 말하고 이유는 어디에도
   * 없었다. 그 화면이 이제 사유를 그리므로(`programs/program-apply-views.tsx`의
   * `BlockedView`) 문구도 그 사실을 가리킨다.
   */
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
    // 안내가 가리키는 목적지가 실제로 사유를 그리는 화면이어야 한다.
    expect(html).toContain('href="/programs/program-2/apply"');
    expect(html).toContain('반려 사유 확인');
    // 옛 문구가 되살아나는 것을 막는다 — 그 화면은 상태만 말하던 시절의 말이다.
    expect(html).not.toContain('신청 상세에서 상태를 확인해 주세요');
    // 사유 원문은 대시보드까지 오지 않는다 — 알림 payload에 그런 필드가 없다.
    //
    // ⚠ 이 단언은 **렌더된 html**을 본다. `notice` 리터럴의 키를 세면 이 테스트가
    // 자기가 방금 쓴 값을 자기가 검사하는 항진명제가 된다 — 실제로 payload에 사유를
    // 얹어 화면에 그리게 만들어도 통과했다.
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
