import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import { fetchStudentDashboard } from './api';
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
