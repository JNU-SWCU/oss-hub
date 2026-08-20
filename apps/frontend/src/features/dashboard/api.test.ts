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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

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
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      await expect(fetchStudentDashboard()).resolves.toEqual(body);
    },
  );
  it.each([
    ['items가 배열이 아님', { items: null }],
    [
      '지원 방식이 계약 밖 값',
      {
        items: [
          {
            ...dashboardFixture.items[0],
            applicationMode: 'GROUP',
          },
        ],
      },
    ],
    [
      '승인 전인데 마일스톤이 존재함',
      {
        items: [
          {
            ...dashboardFixture.items[0],
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
            ...dashboardFixture.items[0],
            applicationStatus: 'REJECTED',
            nextMilestone: null,
            repository: null,
            detailUrl: `/programs/${dashboardFixture.items[0].programId}`,
          },
        ],
      },
    ],
    [
      '승인 신청인데 신청서 화면을 가리킴',
      {
        items: [
          {
            ...dashboardFixture.items[0],
            detailUrl: `/programs/${dashboardFixture.items[0].programId}/apply`,
          },
        ],
      },
    ],
    [
      '유효하지 않은 마감 시각',
      {
        items: [
          {
            ...dashboardFixture.items[0],
            nextMilestone: {
              ...dashboardFixture.items[0].nextMilestone,
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
            ...dashboardFixture.items[0],
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
            ...dashboardFixture.items[0],
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
            ...dashboardFixture.items[0],
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
            ...dashboardFixture.items[0],
            programId: '..',
            detailUrl: '/programs/..',
            checklistUrl: '/programs/../submissions',
          },
        ],
      },
    ],
    [
      '저장소 URL에 쿼리 문자열이 붙음',
      {
        items: [
          {
            ...dashboardFixture.items[0],
            repository: {
              ...dashboardFixture.items[0].repository,
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
            ...dashboardFixture.items[0],
            repository: {
              ...dashboardFixture.items[0].repository,
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
            ...dashboardFixture.items[0],
            repository: {
              ...dashboardFixture.items[0].repository,
              repositoryName: '../evil',
              githubUrl: 'https://github.com/JNU-SWCU/../evil',
            },
          },
        ],
      },
    ],
  ])('잘못된 응답을 어댑터 경계에서 거부한다: %s', async (_label, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ ...notice, programId: '../admin' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(fetchUnreadApplicationDecisionNotices()).rejects.toThrow(
      '신청 승인 알림 응답 형식이 올바르지 않습니다.',
    );
  });
});
