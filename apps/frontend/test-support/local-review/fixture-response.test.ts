import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_REVISION_FIXTURE } from './handlers/student-program-fixtures';
import { parseArchiveDetail, parseArchivePage } from '@/features/archive/api';
import { parseRankingPage, parseRankingYears } from '@/features/ranking/api';
import { fetchStudentDashboard } from '@/features/dashboard/api';
import { dashboardFixture } from '@/features/dashboard/fixtures';
import type { StudentDashboard } from '@/features/dashboard/types';
import {
  rememberProgramTeam,
  resolveProgramTeam,
} from './handlers/student-handlers';
import {
  parseLandingArchiveDetail,
  parseLandingArchivePage,
  parseLandingProgramPage,
} from '@/features/landing/landing-overview';
import type {
  StaffDashboardApplicationCounts,
  StaffDashboardSubmissionSummary,
  StaffDashboardSummary,
} from '@/features/programs/types';
import { localReviewNow } from './fixture-clock';
import {
  resetLocalReviewFixtureState,
  resolveLocalReviewResponse,
} from './fixture-response';
import { STAFF_PROGRAM_FIXTURES } from './handlers/staff-program-fixtures';
import {
  createLocalReviewActivation,
  type LocalReviewFixtureId,
} from '@/lib/local-review-runtime';

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

/**
 * 교직원 대시보드 카드가 적어야 할 집계를 카드가 링크하는 픽스처에서 다시 센다.
 * 세는 방법은 backend와 같다 — 승인 대기는 제출 건수 그대로(`staff-dashboard.service.ts`),
 * 제출 칸은 승인된 신청 × 마일스톤이고 마일스톤은 프로그램의 전부다
 * (`submission-dashboard-summary.service.ts`).
 */
function staffCardCounts(programId: string): {
  readonly applications: StaffDashboardApplicationCounts;
  readonly submissions: StaffDashboardSubmissionSummary;
} {
  const fixture = STAFF_PROGRAM_FIXTURES.find(
    (candidate) => candidate.program.id === programId,
  );
  if (fixture === undefined) {
    throw new Error(`대시보드 카드가 없는 프로그램을 가리킨다: ${programId}`);
  }
  const applications = (status: string) =>
    fixture.applications.filter((item) => item.status === status).length;
  const cells = fixture.matrixRows.flatMap((row) => row.cells);
  const cellsWith = (status: string) =>
    cells.filter((cell) => cell.status === status).length;
  return {
    applications: {
      total: fixture.applications.length,
      submitted: applications('SUBMITTED'),
      pendingApproval: applications('SUBMITTED'),
      approved: applications('APPROVED'),
      rejected: applications('REJECTED'),
    },
    submissions: {
      approvedApplications: fixture.matrixRows.length,
      milestones: fixture.program.milestones.length,
      total: fixture.matrixRows.length * fixture.program.milestones.length,
      notSubmitted: cellsWith('NOT_SUBMITTED'),
      submitted: cellsWith('SUBMITTED'),
      approved: cellsWith('APPROVED'),
      changesRequested: cellsWith('CHANGES_REQUESTED'),
      rejected: cellsWith('REJECTED'),
    },
  };
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
    const staffAccessRequest = resolveLocalReviewResponse({
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
    expect(staffAccessRequest).toEqual({
      kind: 'json',
      status: 200,
      body: null,
    });
  });

  it('loading and error fixtures remain distinguishable at the session boundary', () => {
    // Given / When
    const loading = sessionFor('loading');
    const error = sessionFor('error');

    // Then
    expect(loading).toEqual({ kind: 'delay', milliseconds: 60_000 });
    expect(error).toMatchObject({ kind: 'json', status: 503 });
  });

  it('error-once fixture fails the first session read and recovers on retry', () => {
    // Given
    resetLocalReviewFixtureState();

    // When: 화면이 처음 세션을 읽고, 오류 화면의 "다시 시도"가 같은 경로를 다시 읽는다.
    const first = sessionFor('error-once');
    const second = sessionFor('error-once');
    // 새로고침도 재시도와 같은 조회다 — 복구된 로그인이 유지돼야 한다.
    const afterReload = sessionFor('error-once');

    // Then
    expect(first).toMatchObject({ kind: 'json', status: 503 });
    expect(second).toMatchObject({
      kind: 'json',
      status: 200,
      body: { isAuthenticated: true, user: { role: 'STUDENT' } },
    });
    expect(afterReload).toEqual(second);
  });

  it('error-once fixture fails again after another persona is reviewed in between', () => {
    // Given: 실패를 한 번 쓰고 복구까지 확인한 상태.
    resetLocalReviewFixtureState();
    sessionFor('error-once');
    sessionFor('error-once');

    // When: 다른 페르소나를 보고 돌아온다 — 검토판에서 페르소나를 바꾸는 동작이다.
    sessionFor('student');
    const returned = sessionFor('error-once');

    // Then: 예산이 다시 차지 않으면 서버를 재시작하기 전에는 오류 화면을 볼 수 없다.
    expect(returned).toMatchObject({ kind: 'json', status: 503 });
  });

  it('error-once fixture keeps public data working while the session read fails', () => {
    // Given: 세션만 흔들리는 상태여야 복구 대상이 무엇인지 흐려지지 않는다.
    resetLocalReviewFixtureState();

    // When
    const programs = publicGet('error-once', 'programs');
    const session = sessionFor('error-once');

    // Then: 공개 목록은 그대로 오고, 실패는 세션 조회에서만 난다.
    expect(programs).toMatchObject({ kind: 'json', status: 200 });
    expect(session).toMatchObject({ kind: 'json', status: 503 });
  });

  it('error-once fixture lands on the student dashboard once recovered', () => {
    // Given
    resetLocalReviewFixtureState();
    sessionFor('error-once');
    sessionFor('error-once');

    // When
    const dashboard = resolveLocalReviewResponse({
      fixture: 'error-once',
      method: 'GET',
      path: 'dashboard/student',
      searchParams: new URLSearchParams(),
    });

    // Then: 복구한 학생이 빈 화면이 아니라 자기 카드를 본다.
    expect(dashboard).toMatchObject({ kind: 'json', status: 200 });
    expect(
      (jsonBody(dashboard) as StudentDashboard).items.length,
    ).toBeGreaterThan(0);
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

  it('program overview fixtures expose ordered remaining milestone schedules', () => {
    // Given / When: the program scope sidebar loads active and completed overview fixtures.
    const capstone = jsonBody(
      publicGet('student', 'programs/program-capstone/overview'),
    );
    const rejectedProgram = jsonBody(
      publicGet('student', 'programs/program-sw-value/overview'),
    );
    const archivedProgram = jsonBody(
      publicGet('student', 'programs/program-archived-internship/overview'),
    );

    // Then: the active fixture carries every future deadline in API order, and the completed
    // fixture is an explicitly loaded empty list rather than undefined or a legacy singleton.
    expect(capstone).not.toHaveProperty('nextMilestone');
    expect(capstone).toHaveProperty('remainingMilestones', [
      {
        label: '중간 보고',
        dueAt: '2026-09-01T09:00:00.000Z',
      },
      {
        label: '최종 결과 요약',
        dueAt: '2026-09-12T09:00:00.000Z',
      },
      {
        // 마감 전 보완 요청 마일스톤(#1090). 마감이 상대 시간이라 값을 적지 않고
        // 픽스처가 내보내는 것과 같은 자리에서 가져온다 — 고정 날짜를 적으면
        // 그날이 지나는 순간 이 테스트가 시한폭탄이 된다.
        label: OPEN_REVISION_FIXTURE.name,
        dueAt: OPEN_REVISION_FIXTURE.deadline.dueAt,
      },
    ]);
    expect(rejectedProgram).not.toHaveProperty('nextMilestone');
    expect(rejectedProgram).toHaveProperty('remainingMilestones', []);
    expect(archivedProgram).not.toHaveProperty('nextMilestone');
    expect(archivedProgram).toHaveProperty('remainingMilestones', []);
  });

  it.each([
    ['program-capstone', 'milestones-upcoming', 'MILESTONE_CLOSED'],
  ] as const)(
    '%s checklist submit link resolves to a blocked synthetic %s form',
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

  // 파일 제출 화면을 실제로 눌러 볼 수 있는 마일스톤이 하나는 있어야 한다. 예전에는
  // 유일한 FILE 마일스톤이 막혀 있어, 학생이 파일을 고르고 제출을 누르는 화면을 로컬
  // 검토에서 아무도 열어 볼 수 없었다 — 그 사각지대가 「눌러도 아무 일이 없다」는
  // 결함이 배포까지 살아남은 이유다.
  it('파일 제출 화면을 눌러 볼 수 있는 마일스톤이 학생 픽스처에 있다', () => {
    // Given / When
    const form = resolveLocalReviewResponse({
      fixture: 'student',
      method: 'GET',
      path: 'programs/program-oss-contest/milestones/milestones-contest-final/submission-form',
      searchParams: new URLSearchParams(),
    });

    // Then: 파일 유형이고 제출이 열려 있다.
    expect(form).toMatchObject({
      kind: 'json',
      status: 200,
      body: {
        milestone: { id: 'milestones-contest-final', submissionType: 'FILE' },
        canSubmit: true,
        blockedReason: null,
        existingSubmission: null,
      },
    });

    // Then: 그 제출이 실제 backend로 새지 않고 합성 응답으로 끝난다.
    for (const path of ['submission-files', 'submissions']) {
      expect(
        resolveLocalReviewResponse({
          fixture: 'student',
          method: 'POST',
          path,
          searchParams: new URLSearchParams(),
        }),
      ).toMatchObject({ kind: 'json' });
    }
  });

  /*
   * 재제출 폼을 **눌러서 열 수 있는** 서류가 하나는 있어야 한다.
   *
   * 한때 학생 픽스처의 보완 요청 서류는 전부 마감이 지나 있었다. 제출물 체크리스트의
   * 「다시 제출」은 마감이 지나면 상태와 무관하게 비활성이라(`ChecklistRow`), 그 버튼이
   * 한 번도 눌리지 않아 재제출 폼을 로컬 검토에서 열 수 없었다 — 폼 안의 「기존 제출
   * 파일」과 첨부가 빠진다는 경고도 그래서 아무도 눈으로 보지 못했다.
   *
   * 마감을 **미래의 고정 날짜로** 적어 두면 그날이 지나는 순간 같은 사각지대로 돌아온다.
   * 그래서 픽스처는 기준 시각에서 상대로 마감을 만들고, 이 테스트는 그 성질 자체를
   * 고정한다 — 날짜를 적지 않고 「지금보다 뒤인가」를 본다.
   */
  it('마감이 남은 보완 요청 서류가 있어 재제출 폼을 열 수 있다', () => {
    // Given: 학생 체크리스트와 그 마일스톤의 서류.
    const checklist = jsonBody(
      resolveLocalReviewResponse({
        fixture: 'student',
        method: 'GET',
        path: 'programs/program-capstone/submissions/me',
        searchParams: new URLSearchParams(),
      }),
    ) as {
      readonly items: readonly {
        readonly milestoneId: string;
        readonly dueAt: string;
        readonly submission: { readonly canResubmit: boolean } | null;
      }[];
    };

    // When: 마감이 아직 남았고 다시 낼 수 있는 줄을 찾는다.
    const open = checklist.items.filter(
      (item) =>
        item.submission?.canResubmit === true &&
        Date.parse(item.dueAt) > localReviewNow().getTime(),
    );

    // Then: 그런 줄이 하나는 있고, 그 서류에는 지금 붙어 있는 첨부가 있다.
    expect(open.length).toBeGreaterThan(0);
    const documents = jsonBody(
      resolveLocalReviewResponse({
        fixture: 'student',
        method: 'GET',
        path: `milestones/${open[0]?.milestoneId}/documents`,
        searchParams: new URLSearchParams(),
      }),
      // 목록은 서류 배열만이 아니라 업로드 상한을 함께 실은 봉투다(#1107).
    ) as {
      readonly documents: readonly {
        readonly viewerSubmission?: {
          readonly status: string | null;
          readonly hasCurrentFile: boolean;
          readonly currentFileName: string | null;
        };
      }[];
    };

    expect(documents.documents).toContainEqual(
      expect.objectContaining({
        viewerSubmission: expect.objectContaining({
          status: 'CHANGES_REQUESTED',
          hasCurrentFile: true,
          // 이름이 비면 폼이 「기존 제출 파일」 줄을 세우지 못한다.
          currentFileName: expect.any(String),
        }),
      }),
    );
  });

  /*
   * 위 서류와 짝이 되는 반대쪽 — 마감이 지난 보완 요청도 남아 있어야 한다. 마감 뒤에도
   * 보완 요청만은 다시 낼 수 있다는 규칙(`isMilestoneDocumentDeadlineLocked`)을 눈으로
   * 보는 자리가 그것뿐이라, 새 서류를 넣으면서 이쪽을 옮기거나 지우면 안 된다.
   */
  it('마감이 지난 보완 요청 서류도 그대로 남아 있다', () => {
    // Given / When
    const checklist = jsonBody(
      resolveLocalReviewResponse({
        fixture: 'student',
        method: 'GET',
        path: 'programs/program-capstone/submissions/me',
        searchParams: new URLSearchParams(),
      }),
    ) as {
      readonly items: readonly {
        readonly dueAt: string;
        readonly submission: { readonly canResubmit: boolean } | null;
      }[];
    };

    // Then
    expect(
      checklist.items.filter(
        (item) =>
          item.submission?.canResubmit === true &&
          Date.parse(item.dueAt) < localReviewNow().getTime(),
      ).length,
    ).toBeGreaterThan(0);
  });

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

  it('교직원 대시보드 카드의 집계는 카드에서 넘어가는 화면과 같은 값이다', () => {
    // Given: 교직원 대시보드 요약.
    const summary = jsonBody(
      resolveLocalReviewResponse({
        fixture: 'staff',
        method: 'GET',
        path: 'dashboard/staff/summary',
        searchParams: new URLSearchParams(),
      }),
    ) as StaffDashboardSummary;

    // When: 카드가 링크하는 신청자 목록·제출 현황 픽스처에서 같은 값을 다시 센다.
    const printed = summary.programs.map((program) => ({
      id: program.id,
      applications: program.applications,
      submissions: program.submissions,
    }));
    const counted = summary.programs.map((program) => ({
      id: program.id,
      ...staffCardCounts(program.id),
    }));

    // Then: 카드를 누르면 바로 이 숫자들의 출처 화면으로 넘어간다 — 어긋나면
    // 검토자가 화면의 숫자를 의심하게 되고, 그 자체가 검토 노이즈가 된다.
    expect(printed).toEqual(counted);
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

  it.each([
    ['', 'admin', 'console'].join('/'),
    '//evil.com',
    'https://evil.com',
  ])(
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
    const archive = jsonBody(publicGet('anonymous', 'projects', 'pageSize=3'));

    // When: the landing parsers consume them.
    const parsedPrograms = parseLandingProgramPage(programs);
    const parsedArchive = parseLandingArchivePage(archive);
    const parsedDetails = parsedArchive.map(({ projectId }) =>
      parseLandingArchiveDetail(
        jsonBody(publicGet('anonymous', `projects/${projectId}`)),
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
          contributor.githubLogin.startsWith('synthetic-'),
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

  it('상태 뱃지와 목록 필터가 같은 판정을 쓴다', () => {
    // Given: 사이드바 뱃지가 5키를 읽는다 — QA8 이 404 로 못 받던 그 응답이다.
    const counts = jsonBody(
      publicGet('anonymous', 'programs/status-counts'),
    ) as Record<string, number>;

    // Then: 5키가 모두 있고 all 이 나머지 넷의 합이다(정의상 파티션).
    const parts = ['recruiting', 'in_progress', 'upcoming', 'ended'] as const;
    for (const key of ['all', ...parts]) {
      expect(typeof counts[key]).toBe('number');
    }
    expect(parts.reduce((sum, key) => sum + counts[key], 0)).toBe(counts.all);

    // And: 뱃지 숫자와 그 상태로 거른 목록 건수가 일치한다. 어긋나면 화면은
    // 멀쩡한데 답이 틀리는 상태가 된다 — 빈 화면보다 나쁘다.
    // 픽스처가 `scheduled`·`closed` 라는 API 에 없는 어휘를 쓰던 동안에는
    // `upcoming`·`in_progress`·`ended` 가 전부 0건이었다.
    for (const status of parts) {
      const page = jsonBody(
        publicGet(
          'anonymous',
          'programs',
          `page=1&pageSize=50&status=${status}`,
        ),
      ) as { totalItems: number };
      expect(page.totalItems).toBe(counts[status]);
    }
  });

  it('랭킹 응답이 랭킹 화면 파서를 통과한다', () => {
    // QA9 — 픽스처 폴더 전체에 `ranking` 이 한 번도 없어 두 요청 모두 404 였다.
    const page = parseRankingPage(
      jsonBody(publicGet('anonymous', 'ranking', 'page=1&pageSize=20')),
    );
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.total).toBe(page.items.length);

    const years = parseRankingYears(
      jsonBody(publicGet('anonymous', 'ranking/years')),
    );
    expect(years.years.length).toBeGreaterThan(0);

    // 연도를 바꾸면 실제로 다른 결과가 나와야 한다. 모든 연도가 같은 행이면
    // 검토자가 연도 필터가 도는지 확인할 방법이 없다 — 픽스처가 계약보다
    // 너그러운 상태이고, 이 PR 이 없애려는 것이 바로 그것이다.
    const perYear = years.years.map((year) =>
      parseRankingPage(
        jsonBody(publicGet('anonymous', 'ranking', `year=${year}`)),
      ),
    );
    for (const [index, yearPage] of perYear.entries()) {
      expect(yearPage.year).toBe(years.years[index]);
    }
    if (
      page.viewerClass !== 'public' ||
      perYear.some((yearPage) => yearPage.viewerClass !== 'public')
    ) {
      throw new TypeError('anonymous ranking fixtures must stay public');
    }
    const signatures = perYear.map((yearPage) =>
      yearPage.items
        .map(
          (item) =>
            `${item.githubLogin}:${item.commitCount + item.pullRequestCount}`,
        )
        .join(),
    );
    expect(new Set(signatures).size).toBe(signatures.length);

    // 그리고 전체(`all`)는 연도별 합이라 어느 한 해보다 공개 지표 합이 크다.
    const top = (
      rows: readonly {
        readonly commitCount: number;
        readonly pullRequestCount: number;
      }[],
    ) => (rows[0] ? rows[0].commitCount + rows[0].pullRequestCount : 0);
    expect(top(page.items)).toBeGreaterThanOrEqual(
      Math.max(...perYear.map((yearPage) => top(yearPage.items))),
    );
  });

  it('랭킹 픽스처가 계층을 지킨다 — 비로그인·학생은 같고 교직원만 실명을 받는다', () => {
    // 픽스처가 계층을 무시하면 검토자가 권한별 화면을 눈으로 확인할 수 없고,
    // 더 나쁘게는 비로그인 응답에 실명이 섞인 모양을 정상으로 보게 된다.
    const read = (fixture: LocalReviewFixtureId) =>
      parseRankingPage(jsonBody(publicGet(fixture, 'ranking', 'year=2026')));

    const anonymous = read('anonymous');
    const student = read('student');
    const staff = read('staff');
    const admin = read('admin');

    expect(anonymous.viewerClass).toBe('public');
    expect(student.viewerClass).toBe('public');
    expect(staff.viewerClass).toBe('staff');
    expect(admin.viewerClass).toBe('staff');
    if (
      anonymous.viewerClass !== 'public' ||
      student.viewerClass !== 'public' ||
      staff.viewerClass !== 'staff' ||
      admin.viewerClass !== 'staff'
    ) {
      throw new TypeError('ranking fixture viewer classes are inconsistent');
    }

    for (const item of [...anonymous.items, ...student.items]) {
      expect(Object.keys(item).sort()).toEqual([
        'commitCount',
        'githubLogin',
        'pullRequestCount',
        'rank',
      ]);
    }
    expect(student.items).toEqual(anonymous.items);

    expect(staff.items).toEqual(admin.items);
    expect(
      staff.items.every((item) => item.displayName === item.githubLogin),
    ).toBe(true);
    expect(staff.items.some((item) => item.name !== null)).toBe(true);

    // 순서는 계층과 무관하다 — 누가 보든 같은 사람이 같은 등수다.
    expect(staff.items.map((item) => item.githubLogin)).toEqual(
      anonymous.items.map((item) => item.githubLogin),
    );

    expect(staff.items.some((item) => item.department !== null)).toBe(true);
    expect(staff.items.some((item) => item.department === null)).toBe(true);
  });

  it('public archive reads parse with the archive screen parsers', () => {
    // Given / When: the /archive list and one of its detail links.
    const list = parseArchivePage(
      jsonBody(publicGet('anonymous', 'projects', 'pageSize=12')),
    );
    const first = list.items[0];
    const detail = parseArchiveDetail(
      jsonBody(publicGet('anonymous', `projects/${first?.projectId}`)),
    );

    // Then: both screens render synthetic rows instead of the error card.
    expect(list.items.length).toBeGreaterThan(0);
    expect(first?.detailUrl).toBe(`/archive/${first?.projectId}`);
    expect(detail.contributors.length).toBeGreaterThan(0);
    expect(detail.repositoryName.startsWith('synthetic-')).toBe(true);
  });

  it('unknown archive ids stay a not-found instead of a synthetic row', () => {
    // Given / When
    const response = publicGet('anonymous', 'projects/unknown-repo');

    // Then
    expect(response).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'SHW_001' },
    });
  });

  it.each(['programs', 'projects', 'projects/synthetic-repo-capstone'])(
    'error fixture still fails for %s',
    (path) => {
      // Given / When
      const response = publicGet('error', path);

      // Then
      expect(response).toMatchObject({ kind: 'json', status: 503 });
    },
  );

  it.each(['programs', 'projects', 'projects/synthetic-repo-capstone'])(
    'loading fixture still delays for %s',
    (path) => {
      // Given / When
      const response = publicGet('loading', path);

      // Then
      expect(response).toEqual({ kind: 'delay', milliseconds: 60_000 });
    },
  );

  it.each(['student', 'staff', 'admin', 'unassigned'] as const)(
    '%s fixture sees the same public shell data as anonymous',
    (fixture) => {
      // Given / When
      const response = publicGet(fixture, 'projects', 'page=1&pageSize=3');

      // Then
      expect(response).toEqual(
        publicGet('anonymous', 'projects', 'pageSize=3'),
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

/**
 * 학생 대시보드는 **지금 소속된 팀**만 담아 온다(#1269). 검토용 응답이 이 규칙을
 * 안 지키면 가장 보고 싶은 것들이 전부 가려진다 — 방금 나간 팀의 카드가 남아 있거나,
 * 취소한 신청이 다음 조회에서 되살아나거나, 카드에 적힌 팀 이름이 실제 팀과 다른
 * 상태를 검토자가 정상으로 본다. 그래서 응답을 **화면이 쓰는 그 어댑터로** 읽어
 * 계약까지 함께 고정한다.
 */
describe('local review student dashboard cards', () => {
  beforeEach(() => {
    resetLocalReviewFixtureState();
  });

  afterEach(() => {
    resetLocalReviewFixtureState();
    vi.unstubAllGlobals();
  });

  function studentSend(
    method: string,
    path: string,
    body?: unknown,
  ): ReturnType<typeof resolveLocalReviewResponse> {
    return resolveLocalReviewResponse({
      fixture: 'student',
      method,
      path,
      searchParams: new URLSearchParams(),
      body,
    });
  }

  function studentDashboardBody(): unknown {
    return jsonBody(studentSend('GET', 'dashboard/student'));
  }

  /**
   * 화면이 실제로 쓰는 어댑터로 읽는다. 필드를 손으로 비교하면 픽스처가 계약보다
   * 너그러워져도 테스트가 통과해 버린다 — 지금 고치려는 것이 바로 그 상태다.
   * 실제 백엔드로 나가지 않도록 응답은 픽스처 경계가 만든 것을 그대로 돌려준다.
   */
  async function parseAsScreen(body: unknown): Promise<StudentDashboard> {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    return fetchStudentDashboard();
  }

  function programIdsOf(dashboard: StudentDashboard): readonly string[] {
    return dashboard.items.map((item) => item.programId);
  }

  /*
   * 기준 상태에서 카드가 서는 프로그램은 **세 개**다. 세션을 건드리지 않은 프로그램
   * 픽스처에서 `synthetic-user-01`은 캡스톤·경진대회·SW가치확산 세 팀의 **현재
   * 구성원**이고, 세 프로그램 모두 그 팀이 낸 신청이 살아 있다
   * (`MY_TEAM_FIXTURES`·`MY_APPLICATION_FIXTURES`). 기초 스터디·내린 인턴십은 팀도
   * 신청도 없어 카드가 서지 않는다.
   *
   * 기대값을 프로덕션 규칙으로 다시 계산하지 않고 **알려진 id·상태·팀 이름을 그대로
   * 적는다** — 같은 술어로 양쪽을 맞추면 투영이 틀려도 테스트는 항상 맞는다.
   */
  it('기준 상태의 카드는 현재 팀·현재 신청에서 나오고 어댑터를 그대로 통과한다', async () => {
    // Given / When: 화면이 대시보드를 한 번 조회한다.
    const dashboard = await parseAsScreen(studentDashboardBody());

    // Then: 지금 소속된 팀이 있고 그 팀의 신청이 보이는 프로그램만 카드가 된다.
    expect(programIdsOf(dashboard)).toEqual([
      'program-capstone',
      'program-oss-contest',
      'program-sw-value',
    ]);

    // 승인된 셋짜리 팀 — 목적지는 프로그램 상세이고, 다음 마일스톤은 지어낸 값이
    // 아니라 마일스톤 투영에서 온다(승인된 기획서를 건너뛰고 중간 보고가 선다).
    expect(dashboard.items[0]).toMatchObject({
      programId: 'program-capstone',
      programName: '합성 캡스톤 2026',
      applicationId: 'application-personal',
      applicationStatus: 'APPROVED',
      teamName: '합성 캡스톤팀',
      teamUrl: '/programs/program-capstone/my-team',
      detailUrl: '/programs/program-capstone',
      checklistUrl: '/programs/program-capstone/submissions',
      nextMilestone: {
        id: 'milestones-upcoming',
        submissionStatus: 'NOT_SUBMITTED',
      },
      repository: { provisionStatus: 'SUCCEEDED' },
    });

    // 승인된 둘짜리 팀. 저장소는 아직 발급 중이라 이름도 주소도 없다.
    expect(dashboard.items[1]).toMatchObject({
      programId: 'program-oss-contest',
      programName: '합성 OSS 경진대회',
      applicationId: 'application-team',
      applicationStatus: 'APPROVED',
      teamName: '합성 경진대회팀',
      teamUrl: '/programs/program-oss-contest/my-team',
      detailUrl: '/programs/program-oss-contest',
      checklistUrl: '/programs/program-oss-contest/submissions',
      nextMilestone: {
        id: 'milestones-overdue',
        submissionStatus: 'CHANGES_REQUESTED',
      },
      repository: { provisionStatus: 'PROCESSING', githubUrl: null },
    });

    // 반려된 1인 팀 — 반려도 그 팀의 구성원이므로 카드는 남고, 목적지만 신청서
    // 화면이다(반려 사유가 실려 오는 화면이 그곳뿐이다, #733). 승인이 아니라
    // 저장소도 마일스톤도 없다 — 디코더가 그 조합만 통과시킨다.
    expect(dashboard.items[2]).toMatchObject({
      programId: 'program-sw-value',
      programName: '합성 SW가치확산 프로그램',
      applicationId: 'synthetic-application-sw-value',
      applicationStatus: 'REJECTED',
      teamName: '합성 가치확산팀',
      teamUrl: '/programs/program-sw-value/my-team',
      detailUrl: '/programs/program-sw-value/apply',
      checklistUrl: '/programs/program-sw-value/submissions',
      nextMilestone: null,
      repository: null,
    });

    // 그리고 그 값들은 팀 화면·신청서 화면이 읽는 것과 같은 것이어야 한다 —
    // 카드만 따로 놀면 한 사람의 화면들이 서로 다른 말을 하게 된다.
    const team = resolveProgramTeam('program-capstone');
    const application = jsonBody(
      studentSend('GET', 'programs/program-capstone/applications/me'),
    ) as { readonly id: string; readonly status: string };
    expect(dashboard.items[0]?.teamName).toBe(team?.name);
    expect(dashboard.items[0]?.applicationId).toBe(application.id);
    expect(dashboard.items[0]?.applicationStatus).toBe(application.status);
  });

  it('팀을 만들고 신청을 내야 그 프로그램의 카드가 생긴다', async () => {
    // Given: 신청 전이라 카드가 없다.
    expect(
      programIdsOf(await parseAsScreen(studentDashboardBody())),
    ).not.toContain('program-basic-study');

    // When: 팀을 먼저 만든다.
    expect(
      studentSend('POST', 'programs/program-basic-study/teams', {
        name: '합성 신규 스터디 팀',
      }),
    ).toMatchObject({ kind: 'json', status: 200 });

    // Then: 아직 카드는 없다 — 카드의 단위는 팀이 아니라 신청이다.
    expect(
      programIdsOf(await parseAsScreen(studentDashboardBody())),
    ).not.toContain('program-basic-study');

    // When: 그 팀으로 신청을 낸다.
    const created = jsonBody(
      studentSend('POST', 'programs/program-basic-study/applications', {}),
    ) as { readonly id: string };

    // Then: 카드가 생기고, 그 값들은 방금 persist 된 신청·팀 그대로다.
    const dashboard = await parseAsScreen(studentDashboardBody());
    const card = dashboard.items.find(
      (item) => item.programId === 'program-basic-study',
    );
    expect(card).toBeDefined();
    expect(card?.applicationId).toBe(created.id);
    expect(card?.teamName).toBe('합성 신규 스터디 팀');
    expect(card?.teamUrl).toBe('/programs/program-basic-study/my-team');
    expect(card?.applicationStatus).toBe('SUBMITTED');
    // 판정 전이라 목적지는 신청서 화면이고, 저장소도 마일스톤도 아직 없다 —
    // 여기서 성공한 GitHub 저장소를 지어내면 실제로는 존재할 수 없는 화면이 된다.
    expect(card?.detailUrl).toBe('/programs/program-basic-study/apply');
    expect(card?.nextMilestone).toBeNull();
    expect(card?.repository).toBeNull();
  });

  it('취소한 신청은 다음 조회에서 되살아나지 않는다', async () => {
    // Given: 방금 낸 신청으로 카드가 하나 생겼다.
    studentSend('POST', 'programs/program-basic-study/teams', {
      name: '합성 신규 스터디 팀',
    });
    studentSend('POST', 'programs/program-basic-study/applications', {});
    expect(programIdsOf(await parseAsScreen(studentDashboardBody()))).toContain(
      'program-basic-study',
    );

    // When: 신청을 취소한다.
    expect(
      studentSend('DELETE', 'programs/program-basic-study/applications/me'),
    ).toMatchObject({ kind: 'json', status: 200 });

    // Then: 그 자리에서 사라지고, 다시 읽어도 고정 픽스처가 되살리지 않는다.
    expect(
      programIdsOf(await parseAsScreen(studentDashboardBody())),
    ).not.toContain('program-basic-study');
    expect(
      programIdsOf(await parseAsScreen(studentDashboardBody())),
    ).not.toContain('program-basic-study');
  });

  it('팀을 떠난 사람의 카드는 그 자리에서 사라진다', async () => {
    // Given: 기준 상태에 캡스톤 카드가 있다.
    expect(programIdsOf(await parseAsScreen(studentDashboardBody()))).toContain(
      'program-capstone',
    );

    // When: 탈퇴·제외가 검토 세션에 남기는 무덤을 그대로 둔다.
    rememberProgramTeam('program-capstone', null);

    // Then: 무덤을 보지 못하면 고정 팀 픽스처가 방금 나간 팀을 되살린다.
    expect(
      programIdsOf(await parseAsScreen(studentDashboardBody())),
    ).not.toContain('program-capstone');
    expect(
      programIdsOf(await parseAsScreen(studentDashboardBody())),
    ).not.toContain('program-capstone');
  });

  it('팀 이름을 바꾸면 카드에 그 이름이 그대로 온다', async () => {
    // Given: 기준 상태의 현재 팀.
    const team = resolveProgramTeam('program-capstone');
    if (team === null) throw new Error('기준 상태에 캡스톤 팀이 없다.');

    // When: 이름만 바꾼 팀이 현재 값이 된다.
    rememberProgramTeam('program-capstone', {
      ...team,
      name: '이름을 바꾼 합성 팀',
    });

    // Then: 카드가 예전 이름을 들고 있으면 검토자는 이름 변경이 안 된 것으로 읽는다.
    const dashboard = await parseAsScreen(studentDashboardBody());
    expect(dashboard.items[0]?.teamName).toBe('이름을 바꾼 합성 팀');
  });

  it('팀 화면 주소가 규약을 벗어나면 어댑터가 응답을 거절한다', async () => {
    // Given: 픽스처가 만든 정상 응답.
    const dashboard = studentDashboardBody() as StudentDashboard;
    const item = dashboard.items[0];
    if (item === undefined) throw new Error('기준 대시보드가 비어 있다.');

    // When / Then: 팀 주소 하나만 외부로 바꿔도 그대로 버튼 href 로 싣지 않는다.
    await expect(
      parseAsScreen({
        items: [{ ...item, teamUrl: 'https://evil.example.com/my-team' }],
      }),
    ).rejects.toThrow('학생 대시보드 응답 형식이 올바르지 않습니다.');
  });

  it.each(['anonymous', 'staff', 'admin'] as const)(
    '%s 페르소나에게는 학생 대시보드를 주지 않는다',
    (fixture) => {
      // Given / When
      const response = resolveLocalReviewResponse({
        fixture,
        method: 'GET',
        path: 'dashboard/student',
        searchParams: new URLSearchParams(),
      });

      // Then: 학생이 아닌 사람에게 합성 카드를 보여 주면 권한별 화면을 확인할 수 없다.
      expect(response).toMatchObject({ kind: 'json', status: 404 });
    },
  );
});
