import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import {
  fetchStudentDashboard,
  fetchUnreadApplicationDecisionNotices,
  markApplicationDecisionNoticeRead,
} from './api';
import { dashboardFixture } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const approvedItem = dashboardFixture.items[0];
if (approvedItem === undefined) throw new Error('dashboard fixture is empty');

/**
 * 키를 **아예 빼고** 보낸다. 빈 값과 없는 키는 서버 쪽 사고의 모양이 다르다 — 앞은
 * 팀 이름을 잃어버린 것이고 뒤는 그 칸을 아직 싣지 않는 옛 응답이다. 둘 중 하나만
 * 막으면 나머지 하나는 화면이 지어낸 문구로 덮인 채 정상처럼 보인다(#1269).
 */
function itemWithout(key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...approvedItem };
  delete copy[key];
  return copy;
}

function respondWith(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

describe('fetchStudentDashboard', () => {
  it('학생 대시보드를 단일 API 요청으로 조회한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(dashboardFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchStudentDashboard()).resolves.toEqual(dashboardFixture);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('dashboard/student'),
      undefined,
    );
  });

  it('OWN 성공 저장소의 외부 GitHub URL과 없는 초대 상태를 수용한다', async () => {
    const item = dashboardFixture.items[0];
    if (!item?.repository) throw new Error('dashboard fixture is empty');
    const body = {
      items: [
        {
          ...item,
          repository: {
            ...item.repository,
            repositoryName: 'synthetic-repository',
            githubUrl:
              'https://github.com/synthetic-owner/synthetic-repository',
            invitationStatus: null,
          },
        },
      ],
    } as const;
    respondWith(body);

    await expect(fetchStudentDashboard()).resolves.toEqual(body);
  });

  /**
   * 판정이 끝나지 않았거나(`SUBMITTED`) 반려된(`REJECTED`) 신청은 신청서 화면으로 간다.
   * 서버(`programs/service/student-dashboard.service.ts`의 `detailUrlFor`)와 한 벌인
   * 규칙이라, 여기가 좁으면 서버가 옳은 주소를 보내도 `parseStudentDashboard` 가 던져서
   * 그 학생의 대시보드가 통째로 오류 화면이 된다(#733).
   */
  it.each(['SUBMITTED', 'REJECTED'] as const)(
    'accepts a %s application detail URL pointing to its apply form',
    async (applicationStatus) => {
      const item = dashboardFixture.items[0];
      if (item === undefined) throw new Error('dashboard fixture is empty');
      const body = {
        items: [
          {
            ...item,
            applicationStatus,
            nextMilestone: null,
            repository: null,
            detailUrl: `/programs/${item.programId}/apply`,
          },
        ],
      } as const;
      respondWith(body);

      await expect(fetchStudentDashboard()).resolves.toEqual(body);
    },
  );

  /**
   * 판정 전 신청에도 팀은 있다 — 1인 팀도 팀이라 서버는 팀 없는 항목을 만들지 않는다.
   * 승인 항목에서만 팀 칸을 확인하면, 「제출은 됐는데 팀 이름이 비어 오는」 응답이
   * 그대로 화면에 실려도 아무도 알아채지 못한다(#1269).
   */
  it('판정 전 신청도 현재 팀 이름과 팀 화면 주소를 그대로 싣는다', async () => {
    const body = {
      items: [
        {
          ...approvedItem,
          applicationStatus: 'SUBMITTED',
          nextMilestone: null,
          repository: null,
          detailUrl: `/programs/${approvedItem.programId}/apply`,
          teamName: '합성 대기 팀',
        },
      ],
    } as const;
    respondWith(body);

    await expect(fetchStudentDashboard()).resolves.toEqual(body);
  });

  it.each([
    ['items가 배열이 아님', { items: null }],
    /*
     * 「지금 소속된 팀」이 이 응답의 계약이다. 이름이 비거나 아예 없이 오면 화면이
     * 「이름 없는 팀」 같은 대체 문구를 지어내는 대신 응답을 거절해야 한다 — 기본값을
     * 채워 넣으면 서버가 팀을 잃어버린 사고가 화면에서는 정상처럼 보인다(#1269).
     */
    [
      '팀 이름이 공백뿐',
      {
        items: [
          {
            ...approvedItem,
            teamName: '   ',
          },
        ],
      },
    ],
    [
      '팀 이름이 빈 문자열',
      {
        items: [
          {
            ...approvedItem,
            teamName: '',
          },
        ],
      },
    ],
    [
      '팀 이름 칸이 아예 없음',
      {
        items: [itemWithout('teamName')],
      },
    ],
    [
      '팀 화면 주소 칸이 아예 없음',
      {
        items: [itemWithout('teamUrl')],
      },
    ],
    /*
     * 팀 화면 주소도 서버가 만든 값을 쓰되 **정확히 이 한 경로**여야 한다. 임의의
     * 외부/내부 주소를 그대로 버튼 href로 옮기면 응답 하나로 사용자를 아무 데나
     * 보낼 수 있게 된다.
     */
    [
      '팀 화면 주소가 외부 주소',
      {
        items: [
          {
            ...approvedItem,
            teamUrl: 'https://evil.example.com/my-team',
          },
        ],
      },
    ],
    [
      '팀 화면 주소가 프로토콜 상대 경로',
      {
        items: [
          {
            ...approvedItem,
            teamUrl: '//evil.example.com/my-team',
          },
        ],
      },
    ],
    /*
     * 주소만 보면 앱 안이라 안전해 보이지만, 카드에 적힌 프로그램과 버튼이 여는 팀이
     * 서로 다른 상태다 — 항목 하나가 이상한 게 아니라 화면이 거짓말을 하게 된다.
     */
    [
      '팀 화면 주소가 다른 프로그램의 팀을 가리킴',
      {
        items: [
          {
            ...approvedItem,
            teamUrl: '/programs/program-oss-contest/my-team',
          },
        ],
      },
    ],
    [
      '팀 화면 주소에 질의 문자열이 붙음',
      {
        items: [
          {
            ...approvedItem,
            teamUrl: `/programs/${approvedItem.programId}/my-team?tab=members`,
          },
        ],
      },
    ],
    [
      '팀 화면 주소 끝에 슬래시가 붙어 정규 경로가 아님',
      {
        items: [
          {
            ...approvedItem,
            teamUrl: `/programs/${approvedItem.programId}/my-team/`,
          },
        ],
      },
    ],
    [
      '팀 화면 주소가 프로그램 상세를 가리킴',
      {
        items: [
          {
            ...approvedItem,
            teamUrl: `/programs/${approvedItem.programId}`,
          },
        ],
      },
    ],
    [
      '승인 전인데 마일스톤이 존재함',
      {
        items: [
          {
            ...approvedItem,
            applicationStatus: 'SUBMITTED',
          },
        ],
      },
    ],
    // 아래 두 줄은 반대 방향의 어긋남을 각각 막는다. 위는 예전 규칙(반려를 프로그램
    // 상세로 보내던 것)이 되살아나는 것을, 아래는 "전부 `/apply`로" 같은 거친 수정이
    // 승인 카드까지 신청서 화면으로 끌고 가는 것을 잡는다. detailUrl 말고는 전부
    // 유효한 항목이라 실패 원인이 그 한 곳으로 좁혀진다.
    [
      '반려 신청인데 신청서 화면이 아닌 곳을 가리킴',
      {
        items: [
          {
            ...approvedItem,
            applicationStatus: 'REJECTED',
            nextMilestone: null,
            repository: null,
            detailUrl: `/programs/${approvedItem.programId}`,
          },
        ],
      },
    ],
    [
      '승인 신청인데 신청서 화면을 가리킴',
      {
        items: [
          {
            ...approvedItem,
            detailUrl: `/programs/${approvedItem.programId}/apply`,
          },
        ],
      },
    ],
    [
      '유효하지 않은 마감 시각',
      {
        items: [
          {
            ...approvedItem,
            nextMilestone: {
              ...approvedItem.nextMilestone,
              dueAt: 'not-a-date',
            },
          },
        ],
      },
    ],
    [
      '외부 프로토콜 상대 경로',
      {
        items: [
          {
            ...approvedItem,
            detailUrl: '//example.com/program',
          },
        ],
      },
    ],
    [
      '역슬래시로 시작하는 외부 경로',
      {
        items: [
          {
            ...approvedItem,
            detailUrl: '/\\example.com/program',
          },
        ],
      },
    ],
    [
      '인코딩된 상위 경로로 다른 내부 화면을 가리킴',
      {
        items: [
          {
            ...approvedItem,
            detailUrl: '/programs/%2e%2e/admin/staff-requests',
          },
        ],
      },
    ],
    [
      '상위 경로 자체를 프로그램 ID로 사용함',
      {
        items: [
          {
            ...approvedItem,
            programId: '..',
            detailUrl: '/programs/..',
            checklistUrl: '/programs/../submissions',
            teamUrl: '/programs/../my-team',
          },
        ],
      },
    ],
    [
      '저장소 URL에 쿼리 문자열이 붙음',
      {
        items: [
          {
            ...approvedItem,
            repository: {
              ...approvedItem.repository,
              githubUrl:
                'https://github.com/JNU-SWCU/capstone-hong?redirect=evil',
            },
          },
        ],
      },
    ],
    [
      '저장소 URL이 유사 GitHub 호스트를 가리킴',
      {
        items: [
          {
            ...approvedItem,
            repository: {
              ...approvedItem.repository,
              githubUrl: 'https://github.com.example/JNU-SWCU/capstone-hong',
            },
          },
        ],
      },
    ],
    [
      '저장소 이름이 상위 경로를 탐색함',
      {
        items: [
          {
            ...approvedItem,
            repository: {
              ...approvedItem.repository,
              repositoryName: '../evil',
              githubUrl: 'https://github.com/JNU-SWCU/../evil',
            },
          },
        ],
      },
    ],
  ])('잘못된 응답을 어댑터 경계에서 거부한다: %s', async (_label, body) => {
    respondWith(body);

    await expect(fetchStudentDashboard()).rejects.toThrow(
      '학생 대시보드 응답 형식이 올바르지 않습니다.',
    );
  });
});

describe('application decision notices', () => {
  const notice = {
    id: 'notification-1',
    applicationId: 'application-1',
    programId: 'program-1',
    programName: '합성 프로그램',
    decision: 'APPROVED',
    decidedAt: '2026-08-09T00:00:00.000Z',
  } as const;

  it('loads unread notices and marks each one read through a scoped endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([notice]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchUnreadApplicationDecisionNotices()).resolves.toEqual([
      notice,
    ]);
    await expect(
      markApplicationDecisionNoticeRead(notice.id),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      apiPath('users/me/notifications/application-decisions'),
      undefined,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      apiPath(
        'users/me/notifications/application-decisions/notification-1/read',
      ),
      { method: 'PATCH' },
    );
  });

  it('rejects malformed and unsafe notice payloads', async () => {
    respondWith([{ ...notice, programId: '../admin' }]);

    await expect(fetchUnreadApplicationDecisionNotices()).rejects.toThrow(
      '신청 승인 알림 응답 형식이 올바르지 않습니다.',
    );
  });
});
