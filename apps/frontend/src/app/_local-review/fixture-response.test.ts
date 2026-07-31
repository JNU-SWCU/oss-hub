import { describe, expect, it } from 'vitest';
import {
  parsePublicArchiveDetail,
  parsePublicArchiveList,
} from '@/features/archive/api';
import { dashboardFixture } from '@/features/dashboard/fixtures';
import {
  parseLandingArchiveDetail,
  parseLandingArchivePage,
  parseLandingProgramPage,
} from '@/features/landing/landing-overview';
import { resolveLocalReviewResponse } from './fixture-response';
import {
  createLocalReviewActivation,
  type LocalReviewFixtureId,
} from './fixture-contract';

function auditLogsFor(query: string) {
  return resolveLocalReviewResponse({
    fixture: 'admin',
    method: 'GET',
    path: 'audit-logs',
    searchParams: new URLSearchParams(query),
  });
}

function auditLogBody(response: ReturnType<typeof resolveLocalReviewResponse>) {
  if (response.kind !== 'json') {
    throw new Error('감사 로그 fixture가 json 응답이 아닙니다.');
  }
  return response.body as {
    readonly items: readonly {
      readonly id: string;
      readonly actor: string;
      readonly action: string;
    }[];
    readonly total: number;
  };
}

function sessionFor(fixture: LocalReviewFixtureId) {
  return resolveLocalReviewResponse({
    fixture,
    method: 'GET',
    path: 'auth/session',
    searchParams: new URLSearchParams(),
  });
}

function publicGet(fixture: LocalReviewFixtureId, path: string, search = '') {
  return resolveLocalReviewResponse({
    fixture,
    method: 'GET',
    path,
    searchParams: new URLSearchParams(search),
  });
}

function jsonBody(
  plan: ReturnType<typeof resolveLocalReviewResponse>,
): unknown {
  if (plan.kind !== 'json') throw new Error('expected a json fixture plan');
  expect(plan.status).toBe(200);
  return plan.body;
}

describe('local review fixture responses', () => {
  it('anonymous fixture returns the public unauthenticated session', () => {
    // Given
    const fixture = 'anonymous';

    // When
    const response = sessionFor(fixture);

    // Then
    expect(response).toEqual({
      kind: 'json',
      status: 200,
      body: { isAuthenticated: false },
    });
  });

  it.each([
    ['student', 'STUDENT'],
    ['staff', 'STAFF'],
    ['admin', 'ADMIN'],
    ['settings', 'STUDENT'],
    ['wrong-role', 'STUDENT'],
  ] as const)('%s fixture exposes only its synthetic role', (fixture, role) => {
    // Given / When
    const response = sessionFor(fixture);

    // Then
    expect(response).toMatchObject({
      kind: 'json',
      status: 200,
      body: {
        isAuthenticated: true,
        user: { role },
      },
    });
  });

  it('unassigned fixture has no role and no role request', () => {
    // Given / When
    const session = sessionFor('unassigned');
    const roleRequest = resolveLocalReviewResponse({
      fixture: 'unassigned',
      method: 'GET',
      path: 'role-requests/me',
      searchParams: new URLSearchParams(),
    });

    // Then
    expect(session).toMatchObject({
      kind: 'json',
      body: {
        isAuthenticated: true,
        user: { role: null },
      },
    });
    expect(roleRequest).toEqual({ kind: 'json', status: 200, body: null });
  });

  it('loading and error fixtures remain distinguishable at the session boundary', () => {
    // Given / When
    const loading = sessionFor('loading');
    const error = sessionFor('error');

    // Then
    expect(loading).toEqual({ kind: 'delay', milliseconds: 60_000 });
    expect(error).toMatchObject({ kind: 'json', status: 503 });
  });

  it('student fixture reuses the dashboard synthetic data', () => {
    // Given / When
    const response = resolveLocalReviewResponse({
      fixture: 'student',
      method: 'GET',
      path: 'dashboard/student',
      searchParams: new URLSearchParams(),
    });

    // Then
    expect(response).toEqual({
      kind: 'json',
      status: 200,
      body: dashboardFixture,
    });
  });

  it('student dashboard program link resolves to matching detail and activity data', () => {
    // Given: the first program exposed by the synthetic dashboard.
    const programId = dashboardFixture.items[0]?.programId;
    expect(programId).toBe('program-capstone');

    // When: the linked detail screen requests its two read models.
    const detail = resolveLocalReviewResponse({
      fixture: 'student',
      method: 'GET',
      path: `programs/${programId}/viewer`,
      searchParams: new URLSearchParams(),
    });
    const activity = resolveLocalReviewResponse({
      fixture: 'student',
      method: 'GET',
      path: `programs/${programId}/activity`,
      searchParams: new URLSearchParams(),
    });

    // Then: the page receives an approved student view and graph data.
    expect(detail).toMatchObject({
      kind: 'json',
      status: 200,
      body: {
        id: programId,
        viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
        milestones: expect.arrayContaining([
          expect.objectContaining({ id: 'milestones-upcoming' }),
        ]),
      },
    });
    expect(activity).toMatchObject({
      kind: 'json',
      status: 200,
      body: [
        expect.objectContaining({ applicationId: 'application-personal' }),
      ],
    });
  });

  it('student dashboard checklist link resolves to milestone submission states', () => {
    // Given: the first program exposed by the synthetic dashboard.
    const programId = dashboardFixture.items[0]?.programId;
    expect(programId).toBe('program-capstone');

    // When: the linked checklist screen requests the student's read model.
    const response = resolveLocalReviewResponse({
      fixture: 'student',
      method: 'GET',
      path: `programs/${programId}/submissions/me`,
      searchParams: new URLSearchParams(),
    });

    // Then: it can render both a pending submission and actionable states.
    expect(response).toMatchObject({
      kind: 'json',
      status: 200,
      body: {
        applicationId: 'application-personal',
        applicationMode: 'PERSONAL',
        items: expect.arrayContaining([
          expect.objectContaining({
            milestoneId: 'milestones-upcoming',
            submission: null,
          }),
          expect.objectContaining({
            milestoneId: 'milestones-revision',
            submission: expect.objectContaining({
              status: 'CHANGES_REQUESTED',
              canResubmit: true,
            }),
          }),
        ]),
      },
    });
  });

  it.each([
    ['program-capstone', 'milestones-upcoming', 'MILESTONE_CLOSED'],
    [
      'program-oss-contest',
      'milestones-contest-final',
      'FILE_UPLOAD_UNAVAILABLE',
    ],
  ] as const)(
    '%s checklist submit link resolves to a safe synthetic %s form',
    (programId, milestoneId, blockedReason) => {
      // Given / When: the linked submit screen requests its read model.
      const response = resolveLocalReviewResponse({
        fixture: 'student',
        method: 'GET',
        path: `programs/${programId}/milestones/${milestoneId}/submission-form`,
        searchParams: new URLSearchParams(),
      });

      // Then: review content renders without enabling a real mutation.
      expect(response).toMatchObject({
        kind: 'json',
        status: 200,
        body: {
          milestone: { id: milestoneId },
          canSubmit: false,
          blockedReason,
          existingSubmission: null,
        },
      });
    },
  );

  it.each(dashboardFixture.items)(
    '$programId exposes every GET read model used by its linked screens',
    ({ programId }) => {
      // Given / When: both dashboard destinations load their dependent reads.
      const paths = [
        `programs/${programId}/viewer`,
        `programs/${programId}/activity`,
        `programs/${programId}/submissions/me`,
      ];
      const responses = paths.map((path) =>
        resolveLocalReviewResponse({
          fixture: 'student',
          method: 'GET',
          path,
          searchParams: new URLSearchParams(),
        }),
      );

      // Then: no linked screen falls through to the local 404 boundary.
      expect(responses).toEqual(
        paths.map(() => expect.objectContaining({ kind: 'json', status: 200 })),
      );
    },
  );

  it('staff, admin, and settings fixtures expose their minimum page data', () => {
    // Given / When
    const staff = resolveLocalReviewResponse({
      fixture: 'staff',
      method: 'GET',
      path: 'dashboard/staff/summary',
      searchParams: new URLSearchParams(),
    });
    const admin = auditLogsFor('page=1&limit=20');
    const profile = resolveLocalReviewResponse({
      fixture: 'settings',
      method: 'GET',
      path: 'users/me/profile',
      searchParams: new URLSearchParams(),
    });
    const notification = resolveLocalReviewResponse({
      fixture: 'settings',
      method: 'GET',
      path: 'users/me/notification-email',
      searchParams: new URLSearchParams(),
    });

    // Then
    expect(staff).toMatchObject({
      kind: 'json',
      body: { programs: expect.any(Array) },
    });
    expect(admin).toMatchObject({
      kind: 'json',
      body: { items: expect.any(Array) },
    });
    expect(profile).toMatchObject({
      kind: 'json',
      body: { isComplete: true },
    });
    expect(notification).toMatchObject({
      kind: 'json',
      body: { notifyEnabled: true },
    });
  });

  it.each(['/', '/programs', '/archive'] as const)(
    'public shell route %s is a fixture entry point that renders its session',
    (target) => {
      // Given: a reviewer opens the local persona entry URL for a shell route.
      const activation = createLocalReviewActivation({
        nodeEnv: 'development',
        enabled: '1',
        backendOrigin: 'http://localhost:4000',
        requestHostname: 'localhost',
        fixtureParam: 'student',
        targetParam: target,
      });

      // When: the landed screen asks the fixture layer for its session.
      const session = sessionFor('student');

      // Then: the reviewer lands on the requested shell route with a role.
      expect(activation).toEqual({
        kind: 'redirect',
        fixture: 'student',
        target,
      });
      expect(session).toMatchObject({
        kind: 'json',
        status: 200,
        body: { isAuthenticated: true, user: { role: 'STUDENT' } },
      });
    },
  );

  it.each(['/admin/console', '//evil.com', 'https://evil.com'])(
    'entry URL target %j stays inside the app instead of open-redirecting',
    (target) => {
      // Given / When
      const activation = createLocalReviewActivation({
        nodeEnv: 'development',
        enabled: '1',
        backendOrigin: 'http://localhost:4000',
        requestHostname: 'localhost',
        fixtureParam: 'anonymous',
        targetParam: target,
      });

      // Then
      expect(activation).toEqual({
        kind: 'redirect',
        fixture: 'anonymous',
        target: '/',
      });
    },
  );

  it('landing public reads parse into programs, archive items, and contributors', () => {
    // Given: the three reads the landing shell issues without a session.
    const programs = jsonBody(
      publicGet(
        'anonymous',
        'programs',
        'page=1&pageSize=3&search=&status=recruiting',
      ),
    );
    const archive = jsonBody(
      publicGet('anonymous', 'repositories/public', 'page=1&pageSize=3'),
    );

    // When: the landing parsers consume them.
    const parsedPrograms = parseLandingProgramPage(programs);
    const parsedArchive = parseLandingArchivePage(archive);
    const parsedDetails = parsedArchive.map(({ repositoryId }) =>
      parseLandingArchiveDetail(
        jsonBody(publicGet('anonymous', `repositories/${repositoryId}/public`)),
      ),
    );

    // Then: the public aggregate counts are non-zero and obviously synthetic.
    expect(parsedPrograms.length).toBeGreaterThan(0);
    expect(parsedArchive.length).toBeGreaterThan(0);
    expect(
      parsedDetails.flatMap((detail) => detail.contributors).length,
    ).toBeGreaterThan(0);
    expect(
      parsedPrograms.every((program) => program.name.startsWith('합성')),
    ).toBe(true);
    expect(
      parsedDetails
        .flatMap((detail) => detail.contributors)
        .every((contributor) =>
          contributor.githubNickname.startsWith('synthetic-'),
        ),
    ).toBe(true);
  });

  it('program list page fixture keeps the requested paging contract', () => {
    // Given / When: the /programs screen asks for every status.
    const body = jsonBody(
      publicGet(
        'anonymous',
        'programs',
        'page=1&pageSize=20&search=&status=all',
      ),
    );
    const recruiting = parseLandingProgramPage(
      jsonBody(
        publicGet(
          'anonymous',
          'programs',
          'page=1&pageSize=3&search=&status=recruiting',
        ),
      ),
    );

    // Then: paging metadata matches the query and status narrows the result.
    expect(body).toMatchObject({
      page: 1,
      pageSize: 20,
      totalPages: 1,
      items: expect.any(Array),
    });
    const all = parseLandingProgramPage(body);
    expect(all.length).toBeGreaterThanOrEqual(recruiting.length);
  });

  it('public archive reads parse with the archive screen parsers', () => {
    // Given / When: the /archive list and one of its detail links.
    const list = parsePublicArchiveList(
      jsonBody(
        publicGet('anonymous', 'repositories/public', 'page=1&pageSize=12'),
      ),
    );
    const first = list.items[0];
    const detail = parsePublicArchiveDetail(
      jsonBody(
        publicGet('anonymous', `repositories/${first?.repositoryId}/public`),
      ),
    );

    // Then: both screens render synthetic rows instead of the error card.
    expect(list.total).toBe(list.items.length);
    expect(list.items.length).toBeGreaterThan(0);
    expect(first?.detailUrl).toBe(`/archive/${first?.repositoryId}`);
    expect(detail.contributors.length).toBeGreaterThan(0);
    expect(detail.repositoryName.startsWith('synthetic-')).toBe(true);
  });

  it('unknown archive ids stay a not-found instead of a synthetic row', () => {
    // Given / When
    const response = publicGet('anonymous', 'repositories/unknown-repo/public');

    // Then
    expect(response).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'SHW_001' },
    });
  });

  it.each([
    'programs',
    'repositories/public',
    'repositories/synthetic-repo-capstone/public',
  ])('error fixture still fails for %s', (path) => {
    // Given / When
    const response = publicGet('error', path);

    // Then
    expect(response).toMatchObject({ kind: 'json', status: 503 });
  });

  it.each([
    'programs',
    'repositories/public',
    'repositories/synthetic-repo-capstone/public',
  ])('loading fixture still delays for %s', (path) => {
    // Given / When
    const response = publicGet('loading', path);

    // Then
    expect(response).toEqual({ kind: 'delay', milliseconds: 60_000 });
  });

  it.each(['student', 'staff', 'admin', 'unassigned'] as const)(
    '%s fixture sees the same public shell data as anonymous',
    (fixture) => {
      // Given / When
      const response = publicGet(
        fixture,
        'repositories/public',
        'page=1&pageSize=3',
      );

      // Then
      expect(response).toEqual(
        publicGet('anonymous', 'repositories/public', 'page=1&pageSize=3'),
      );
    },
  );

  it('요청 본문이 도메인 규칙까지 전달된다', () => {
    // Given: 검토자가 신청자 목록에서 "반려"를 누른 상황.
    const rejected = resolveLocalReviewResponse({
      fixture: 'staff',
      method: 'PATCH',
      path: 'applications/application-basic-submitted',
      searchParams: new URLSearchParams(),
      body: { action: 'REJECT', reason: '합성 반려 사유' },
    });

    // When: 같은 경로에 승인을 보냈을 때와 비교한다.
    const approved = resolveLocalReviewResponse({
      fixture: 'staff',
      method: 'PATCH',
      path: 'applications/application-basic-submitted',
      searchParams: new URLSearchParams(),
      body: { action: 'APPROVE' },
    });

    // Then: 본문이 라우트에서 규칙까지 이어지지 않으면 둘이 같아진다.
    expect(jsonBody(rejected)).toMatchObject({
      status: 'REJECTED',
      rejectionReason: '합성 반려 사유',
    });
    expect(jsonBody(approved)).toMatchObject({ status: 'APPROVED' });
  });

  it('본문 없이 온 요청도 조작 응답을 준다', () => {
    // Given / When: GET·DELETE는 본문이 없는 게 정상이다.
    const deleted = resolveLocalReviewResponse({
      fixture: 'staff',
      method: 'DELETE',
      path: 'milestones/milestone-basic-final',
      searchParams: new URLSearchParams(),
    });

    // Then
    expect(deleted).toMatchObject({ kind: 'json', status: 200 });
  });

  it('admin fixture serves audit logs in the paginated backend shape', () => {
    // Given / When
    const response = auditLogsFor('page=1&limit=2');

    // Then
    expect(response).toMatchObject({
      kind: 'json',
      status: 200,
      body: { page: 1, limit: 2 },
    });
    expect(auditLogBody(response).items).toHaveLength(2);
  });

  it('audit log fixture spans more than one page at the default limit', () => {
    // Given — 기본 limit 20에서 이전·다음을 실제로 눌러 볼 수 있어야 한다.
    const firstPage = auditLogBody(auditLogsFor('page=1&limit=20'));
    const secondPage = auditLogBody(auditLogsFor('page=2&limit=20'));

    // Then
    expect(firstPage.total).toBeGreaterThan(20);
    expect(firstPage.items).toHaveLength(20);
    expect(secondPage.items.length).toBe(firstPage.total - 20);
    expect(secondPage.items.length).toBeGreaterThan(0);

    const ids = [...firstPage.items, ...secondPage.items].map(
      (record) => record.id,
    );
    expect(new Set(ids).size).toBe(firstPage.total);
  });

  it('audit log fixture applies the actor and action filters it is sent', () => {
    // Given / When
    const all = auditLogBody(auditLogsFor('page=1&limit=100'));
    const filtered = auditLogBody(
      auditLogsFor(
        'action=STAFF_ROLE_REQUEST_APPROVED&actor=SYNTHETIC-admin&page=1&limit=100',
      ),
    );

    // Then
    expect(filtered.total).toBeGreaterThan(0);
    expect(filtered.total).toBeLessThan(all.total);
    for (const record of filtered.items) {
      expect(record.action).toBe('STAFF_ROLE_REQUEST_APPROVED');
      expect(record.actor.toLowerCase()).toContain('synthetic-admin');
    }
  });

  it('unsupported paths fail closed instead of reaching the backend', () => {
    // Given / When
    const response = resolveLocalReviewResponse({
      fixture: 'student',
      method: 'POST',
      path: 'unknown',
      searchParams: new URLSearchParams(),
    });

    // Then
    expect(response).toMatchObject({ kind: 'json', status: 404 });
  });
});
