import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import {
  fetchStudentDashboard,
  fetchStudentFeedback,
  fetchUnreadApplicationDecisionNotices,
  markApplicationDecisionNoticeRead,
} from './api';
import { dashboardFixture, feedbackItemFixture } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const approvedItem = dashboardFixture.items[0];
if (approvedItem === undefined) throw new Error('dashboard fixture is empty');

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
    [
      '진행 현황과 남은 서류 수가 있는',
      {
        ...approvedItem,
        nextMilestone: {
          ...approvedItem.nextMilestone,
          requiredItemCount: 3,
          remainingItemCount: 2,
        },
        progress: { approvedCount: 1, inReviewCount: 1, totalCount: 4 },
      },
    ],
    ['진행 현황이 null인', { ...approvedItem, progress: null }],
    ['진행 현황과 남은 서류 수 칸이 없는', approvedItem],
  ])('%s 승인 카드를 그대로 받는다', async (_label, item) => {
    const body = { items: [item] };
    respondWith(body);

    await expect(fetchStudentDashboard()).resolves.toEqual(body);
  });

  it.each([
    ['items가 배열이 아님', { items: null }],

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
      '남은 서류 수가 필수 서류 수보다 큼',
      {
        items: [
          {
            ...approvedItem,
            nextMilestone: {
              ...approvedItem.nextMilestone,
              requiredItemCount: 1,
              remainingItemCount: 2,
            },
          },
        ],
      },
    ],
    [
      '진행 수치가 정수가 아님',
      {
        items: [
          {
            ...approvedItem,
            progress: { approvedCount: 0.5, inReviewCount: 0, totalCount: 2 },
          },
        ],
      },
    ],
    [
      '승인·검토 대기 마일스톤 수가 전체보다 많음',
      {
        items: [
          {
            ...approvedItem,
            progress: { approvedCount: 2, inReviewCount: 1, totalCount: 2 },
          },
        ],
      },
    ],
    [
      '승인 전 신청에 진행 현황이 있음',
      {
        items: [
          {
            ...approvedItem,
            applicationStatus: 'SUBMITTED',
            nextMilestone: null,
            repository: null,
            detailUrl: `/programs/${approvedItem.programId}/apply`,
            progress: { approvedCount: 0, inReviewCount: 0, totalCount: 2 },
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

describe('fetchStudentFeedback', () => {
  it('최근 피드백을 단일 API 요청으로 읽어 항목 배열로 돌려준다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [feedbackItemFixture] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchStudentFeedback()).resolves.toEqual([
      feedbackItemFixture,
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('dashboard/student/feedback'),
      undefined,
    );
  });

  it('의견과 재제출 기한이 없는 판정도 받는다', async () => {
    const item = {
      ...feedbackItemFixture,
      decision: 'APPROVED',
      comment: null,
      resubmissionDueAt: null,
    } as const;
    respondWith({ items: [item] });

    await expect(fetchStudentFeedback()).resolves.toEqual([item]);
  });

  it.each([
    ['items가 배열이 아님', { items: null }],
    ['판정이 검토 대기 상태', { decision: 'SUBMITTED' }],
    ['검토 시각이 날짜가 아님', { reviewedAt: 'not-a-date' }],
    ['재제출 기한이 날짜가 아님', { resubmissionDueAt: 'tomorrow' }],
    ['의견이 문자열이 아님', { comment: 42 }],
    ['항목 이름이 공백뿐', { itemName: '   ' }],
    ['마일스톤 이름 칸이 없음', { milestoneName: undefined }],
    ['카드에 붙일 신청 ID가 없음', { applicationId: undefined }],
    [
      '주소가 외부를 가리킴',
      {
        href: 'https://evil.example.com/programs/program-capstone/documents?milestoneId=milestones-upcoming',
      },
    ],
    [
      '주소가 다른 마일스톤을 가리킴',
      { href: '/programs/program-capstone/documents?milestoneId=other' },
    ],
    [
      '상위 경로를 프로그램 ID로 사용함',
      {
        programId: '..',
        href: '/programs/../documents?milestoneId=milestones-upcoming',
      },
    ],
  ] as const)(
    '잘못된 응답을 어댑터 경계에서 거부한다: %s',
    async (_label, change) => {
      respondWith(
        'items' in change
          ? change
          : { items: [{ ...feedbackItemFixture, ...change }] },
      );

      await expect(fetchStudentFeedback()).rejects.toThrow(
        '최근 피드백 응답 형식이 올바르지 않습니다.',
      );
    },
  );
});
