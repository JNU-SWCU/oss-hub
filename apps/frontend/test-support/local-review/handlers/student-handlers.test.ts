import { describe, expect, it } from 'vitest';
import type { ProgramTeam } from '@/features/programs/api';
import type { MilestoneDocumentList } from '@/features/programs/milestone-document-api';
import type { ProgramActivity, ProgramDetail } from '@/features/programs/types';
import { resolveApplyBlockedReason } from '@/features/programs/program-apply-flow';
import { PROGRAM_TEMPLATE_DEFINITIONS } from '@/features/programs/program-templates';
import type { StudentApplication } from '@/features/programs/student-application-api';
import type { SubmissionFormData } from '@/features/submissions/types';
import type { LocalReviewFixtureId } from '@/lib/local-review-runtime';
import { localReviewSessionState } from '../handler-kit';
import {
  resetLocalReviewFixtureState,
  resolveLocalReviewResponse,
} from '../fixture-response';
import {
  currentSyntheticUserId,
  rememberProgramTeam,
  rosterAfterLeave,
} from './student-handlers';
import { PUBLIC_PROGRAM_IDS } from './student-program-fixtures';

function call(
  fixture: LocalReviewFixtureId,
  method: string,
  path: string,
  search = '',
) {
  return resolveLocalReviewResponse({
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(search),
  });
}
function callWithBody(
  fixture: LocalReviewFixtureId,
  method: string,
  path: string,
  body: unknown,
) {
  return resolveLocalReviewResponse({
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(),
    body,
  });
}

function jsonBody(
  plan: ReturnType<typeof resolveLocalReviewResponse>,
  status = 200,
): unknown {
  if (plan.kind !== 'json') throw new Error('expected a json fixture plan');
  expect(plan.status).toBe(status);
  return plan.body;
}

const STUDENT_FIXTURES = [
  'student',
  'settings',
  'wrong-role',
] as const satisfies readonly LocalReviewFixtureId[];

const SIGNED_IN_FIXTURES = [
  ...STUDENT_FIXTURES,
  'staff',
  'admin',
  'unassigned',
] as const satisfies readonly LocalReviewFixtureId[];

describe('student fixture responses', () => {
  it.each(SIGNED_IN_FIXTURES)(
    '%s fixture sees every public program detail',
    (fixture) => {
      for (const programId of PUBLIC_PROGRAM_IDS) {
        // Given / When
        const detail = jsonBody(
          call(fixture, 'GET', `programs/${programId}/viewer`),
        ) as ProgramDetail;

        // Then
        expect(detail.id).toBe(programId);
        expect(detail.milestones.length).toBeGreaterThan(0);
      }
    },
  );

  it('keeps the existing student journey fixtures in charge for the student persona', () => {
    // Given / When
    const capstone = jsonBody(
      call('student', 'GET', 'programs/program-capstone/viewer'),
    ) as ProgramDetail;

    // Then: 학생 동선 픽스처가 먼저 응답하므로 핸들러 이름이 아니라 그쪽 이름이 온다.
    // 이름은 화면에서 합성임이 드러나야 한다 — 실제 사업단 이름은 쓰지 않는다.
    expect(capstone.name).toBe('합성 캡스톤 2026');
    expect(capstone.viewer).toEqual({
      role: 'STUDENT',
      applicationStatus: 'APPROVED',
    });
  });

  it('answers the signed-out reviewer with 401 so the public detail fallback runs', () => {
    // Given / When: getProgramDetail은 401일 때만 공개 상세로 폴백한다.
    const viewer = call('anonymous', 'GET', 'programs/program-capstone/viewer');
    const publicDetail = jsonBody(
      call('anonymous', 'GET', 'programs/program-capstone'),
    ) as ProgramDetail;

    // Then
    expect(viewer).toMatchObject({ kind: 'json', status: 401 });
    expect(publicDetail.viewer).toEqual({
      role: null,
      applicationStatus: null,
    });
  });

  it('splits found and missing programs so the not-found screen stays reachable', () => {
    // Given / When
    const missingViewer = call(
      'student',
      'GET',
      'programs/program-missing/viewer',
    );
    const missingPublic = call('anonymous', 'GET', 'programs/program-missing');

    // Then: 화면은 code로 not-found와 실패를 가른다.
    expect(missingViewer).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'PROGRAM_NOT_FOUND' },
    });
    expect(missingPublic).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'PROGRAM_NOT_FOUND' },
    });
  });

  it.each(STUDENT_FIXTURES)(
    '%s fixture can reach the apply form on the not-yet-applied program',
    (fixture) => {
      // Given
      const program = jsonBody(
        call(fixture, 'GET', 'programs/program-basic-study/viewer'),
      ) as ProgramDetail;
      const template = PROGRAM_TEMPLATE_DEFINITIONS.find(
        (definition) =>
          definition.template.key === program.applicationTemplateKey,
      )?.template;

      // When
      const blocked =
        template === undefined
          ? 'missing-template'
          : resolveApplyBlockedReason(program, template, null);

      // Then: 신청 전 + 기간 열림 + 개인형이라 어느 이유로도 막히지 않는다.
      expect(program.viewer.applicationStatus).toBeNull();
      expect(blocked).toBeNull();
    },
  );

  it('exposes application templates whose keys match local definitions', () => {
    // Given / When
    const body = jsonBody(
      call('student', 'GET', 'programs/application-templates'),
    ) as { readonly items: readonly { readonly key: string }[] };

    // Then
    expect(body.items.map((item) => item.key)).toEqual(
      PROGRAM_TEMPLATE_DEFINITIONS.map((definition) => definition.template.key),
    );
  });

  it.each(['MONTH', 'YEAR'] as const)(
    'returns an activity timeline the %s parser accepts',
    (granularity) => {
      // Given / When
      const body = jsonBody(
        call(
          'student',
          'GET',
          'dashboard/student/activity-timeline',
          `granularity=${granularity}`,
        ),
      ) as {
        readonly dataAsOf: string;
        readonly series: {
          readonly granularity: string;
          readonly points: readonly {
            readonly period: string;
            readonly commitCount: number;
            readonly pullRequestCount: number;
            readonly releaseCount: number;
            readonly total: number;
          }[];
        };
      };

      // Then: 파서는 요청과 같은 granularity·합계가 맞는 total만 통과시킨다.
      expect(body.series.granularity).toBe(granularity);
      expect(new Date(body.dataAsOf).toISOString()).toBe(body.dataAsOf);
      for (const point of body.series.points) {
        expect(point.total).toBe(
          point.commitCount + point.pullRequestCount + point.releaseCount,
        );
        expect(point.period).toMatch(
          granularity === 'MONTH' ? /^\d{4}-\d{2}$/ : /^\d{4}$/,
        );
      }
    },
  );

  it('keeps the activity timeline out of non-student personas', () => {
    // Given / When
    const staff = call(
      'staff',
      'GET',
      'dashboard/student/activity-timeline',
      'granularity=MONTH',
    );

    // Then
    expect(staff).toMatchObject({ kind: 'json', status: 403 });
  });

  it('fills the program activity panel, including its empty state', () => {
    // Given / When
    const capstone = jsonBody(
      call('staff', 'GET', 'programs/program-capstone/activity'),
    ) as readonly ProgramActivity[];
    const basic = jsonBody(
      call('student', 'GET', 'programs/program-basic-study/activity'),
    ) as readonly ProgramActivity[];

    // Then
    expect(capstone).toHaveLength(1);
    expect(basic).toEqual([]);
  });

  it('reuses the student journey checklist for the other student personas', () => {
    // Given / When
    const settings = jsonBody(
      call('settings', 'GET', 'programs/program-capstone/submissions/me'),
    ) as { readonly applicationId: string };

    // Then
    expect(settings.applicationId).toBe('application-personal');
  });

  /**
   * 프로그램 상세가 「승인된 신청이 있다」고 말하는데 내 신청서 조회는 404를 내면,
   * 그 둘을 함께 읽는 화면이 실제 서버가 만들 수 없는 상태를 그린다 — 좌측 패널이
   * 참여자에게서도 「내 제출물」·「게시판」을 내렸던 것이 그 사고였다(#1099).
   */
  it('keeps the application detail and 내 신청서 answers consistent', () => {
    // Given / When
    const rows = PUBLIC_PROGRAM_IDS.map((programId) => ({
      programId,
      detailStatus: (
        jsonBody(call('student', 'GET', `programs/${programId}/viewer`)) as {
          readonly viewer: { readonly applicationStatus: string | null };
        }
      ).viewer.applicationStatus,
      mine: call('student', 'GET', `programs/${programId}/applications/me`),
    }));

    // Then: 상세가 신청 상태를 말하면 내 신청서도 같은 상태로 200이어야 한다.
    for (const row of rows) {
      if (row.detailStatus === null) {
        expect(row.mine).toMatchObject({ kind: 'json', status: 404 });
        continue;
      }
      expect(row.mine).toMatchObject({
        kind: 'json',
        status: 200,
        body: { programId: row.programId, status: row.detailStatus },
      });
    }
  });

  /**
   * 예전에는 이 갈래가 `404 SUB_001`이었는데 그 조합은 백엔드가 만들 수 없다 —
   * `SUB_001`은 403 「학생 계정만 제출할 수 있습니다」다. 그래서 로컬 검토에서 본
   * 화면과 배포에서 나는 화면이 서로 다른 갈래였고, 참여자 아님 안내(#1099)에
   * 도달하는지 아무도 눈으로 확인할 수 없었다.
   */
  it('denies the checklist with the same 403 codes the backend raises', () => {
    // Given / When: 신청 전(기초 스터디)과 반려된 신청(SW가치확산).
    const neverApplied = call(
      'student',
      'GET',
      'programs/program-basic-study/submissions/me',
    );
    const notApproved = call(
      'student',
      'GET',
      'programs/program-sw-value/submissions/me',
    );

    // Then: 신청 없음은 SUB_003, 승인 안 된 신청은 SUB_004다.
    expect(neverApplied).toMatchObject({
      kind: 'json',
      status: 403,
      body: { code: 'SUB_003' },
    });
    expect(notApproved).toMatchObject({
      kind: 'json',
      status: 403,
      body: { code: 'SUB_004' },
    });
  });

  it('opens an unblocked submission form that no other screen can show', () => {
    // Given / When
    const open = jsonBody(
      call(
        'student',
        'GET',
        'programs/program-basic-study/milestones/milestones-basic-intro/submission-form',
      ),
    ) as SubmissionFormData;
    const blocked = jsonBody(
      call(
        'student',
        'GET',
        'programs/program-capstone/milestones/milestones-approved/submission-form',
      ),
    ) as SubmissionFormData;
    const missing = call(
      'student',
      'GET',
      'programs/program-capstone/milestones/milestones-missing/submission-form',
    );

    // Then
    expect(open).toMatchObject({ canSubmit: true, blockedReason: null });
    expect(blocked).toMatchObject({
      canSubmit: false,
      blockedReason: 'SUBMISSION_ALREADY_EXISTS',
    });
    expect(missing).toMatchObject({ kind: 'json', status: 404 });
  });

  /**
   * 반려 사유가 로컬 검토 응답에 **실려 있는가**(#722).
   *
   * 이 경로는 커버리지 목록의 `KNOWN_GAPS`에 있던 항목이라, 규칙이 없는 동안
   * `/programs/{id}/apply`는 내 신청서를 아예 못 읽었다. 사유가 실려 오는 곳은 이
   * 응답 하나뿐이라(알림·감사 로그·메일에는 없다) 여기가 비면 화면도 빈다.
   *
   * 여기는 **응답까지만** 본다. 그 응답이 화면에 실제로 그려지는지는 화면을 마운트하는
   * `student-rejection-reach.test.tsx`가 맡는다. 이 파일에 있던 "반려 픽스처는 신청 상세가
   * 사유 화면으로 갈리는 조건을 만족한다"는 테스트는 이름과 달리 화면을 렌더하지 않고
   * 응답 필드만 봤다 — 불러오기가 내 신청서 조회를 그만두도록 바뀌어도 초록불이고 화면만
   * 비었을 자리라, 화면을 실제로 세우는 검사로 옮겼다.
   */
  it('반려된 신청은 사유를 실어 돌려준다', () => {
    // Given / When
    const application = jsonBody(
      call('student', 'GET', 'programs/program-sw-value/applications/me'),
    ) as StudentApplication;

    // Then
    expect(application.status).toBe('REJECTED');
    expect(application.rejectionReason).toContain(
      '제출하신 요약이 프로그램 주제와 맞지 않습니다.',
    );
  });

  /**
   * 실패는 backend `StudentApplicationManagementService.requireContext`의 순서를
   * 그대로 따른다. 픽스처가 실제 계약보다 너그럽거나 다른 코드를 주면, 배포에서는
   * 나지 않는 갈래가 검토에서만 보인다.
   */
  it.each([
    ['신청이 없는 프로그램', 'student', 'program-basic-study', 404, 'APP_001'],
    ['없는 프로그램', 'student', 'synthetic-missing', 404, 'APP_009'],
    ['학생이 아닌 역할', 'staff', 'program-sw-value', 403, 'APP_008'],
    // 역할 검사가 프로그램 검사보다 **먼저**라는 것을 이 한 줄이 고정한다.
    // 둘을 뒤집으면 여기서만 404 APP_009 가 나와 실제 backend 와 갈린다.
    [
      '학생이 아닌 역할 + 없는 프로그램',
      'staff',
      'synthetic-missing',
      403,
      'APP_008',
    ],
    ['비로그인', 'anonymous', 'program-sw-value', 401, 'AUT_003'],
  ] as readonly (readonly [
    string,
    LocalReviewFixtureId,
    string,
    number,
    string,
  ])[])(
    '%s은 실제 도메인 코드로 답한다',
    (_label, fixture, programId, status, code) => {
      // Given / When
      const plan = call(
        fixture,
        'GET',
        `programs/${programId}/applications/me`,
      );

      // Then — 경로를 모른다는 뜻의 `LFX_404`가 아니라 도메인 응답이어야 한다.
      expect(plan).toMatchObject({ kind: 'json', status, body: { code } });
    },
  );

  it('splits the two team states so both team screens are reviewable', () => {
    // Given / When: 기초 스터디는 팀도 신청도 없는 입구다 — 정보를 먼저 읽고
    // 직접 팀을 만들어 신청까지 걸어 볼 수 있어야 한다.
    const withTeam = jsonBody(
      call('student', 'GET', 'programs/program-capstone/teams/me'),
    ) as { readonly members: readonly unknown[] };
    const withoutTeam = call(
      'student',
      'GET',
      'programs/program-basic-study/teams/me',
    );

    // Then: 404는 화면에서 "팀 만들기" 화면으로 갈린다.
    expect(withTeam.members).toHaveLength(3);
    expect(withoutTeam).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'TEAM_010' },
    });
    // 그리고 그 입구에는 신청 기록도 없다 — 둘이 같이 없어야 새로 걸어 볼 수 있다.
    expect(
      call('student', 'GET', 'programs/program-basic-study/applications/me'),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'APP_001' } });
  });

  /**
   * 신청은 항상 팀이 낸다(#1269) — 혼자면 1인 팀이 만들어지고, 그 신청서를 볼 수
   * 있는 근거도 「그 팀의 구성원」뿐이다. 팀 없는 신청 픽스처를 하나라도 두면
   * 픽스처가 소속 없는 사람에게 참여자 응답을 내주는 폴백을 되살리게 된다.
   */
  it('신청이 보이는 프로그램은 예외 없이 그 신청을 낸 팀의 구성원일 때뿐이다', () => {
    resetLocalReviewFixtureState();

    for (const programId of PUBLIC_PROGRAM_IDS) {
      // Given / When
      const mine = call(
        'student',
        'GET',
        `programs/${programId}/applications/me`,
      );
      if (mine.kind !== 'json' || mine.status !== 200) continue;

      // Then: 신청이 보이면 팀도 보이고, 그 팀이 바로 신청이 가리키는 팀이다.
      const team = jsonBody(
        call('student', 'GET', `programs/${programId}/teams/me`),
      ) as ProgramTeam;
      expect({
        programId,
        teamId: (mine.body as StudentApplication).teamId,
      }).toEqual({ programId, teamId: team.id });
      expect(team.hasApplication).toBe(true);
    }
  });

  it('succeeds on every student action a screen can trigger', () => {
    resetLocalReviewFixtureState();
    const created = jsonBody(
      callWithBody('student', 'POST', 'programs/program-basic-study/teams', {
        name: '합성 기초팀',
      }),
    ) as { readonly id: string };
    const application = jsonBody(
      call('student', 'POST', 'programs/program-basic-study/applications'),
    );
    const submission = jsonBody(call('student', 'POST', 'submissions'));
    const file = jsonBody(call('student', 'POST', 'submission-files'));
    const resubmission = jsonBody(
      call('student', 'POST', 'submissions/submission-revision/resubmissions'),
    );

    expect(application).toMatchObject({
      programId: 'program-basic-study',
      status: 'SUBMITTED',
      teamId: created.id,
    });
    expect(created).toMatchObject({
      name: '합성 기초팀',
      joinCode: 'FIXTURE01',
      memberCount: 1,
    });
    expect(submission).toMatchObject({ status: 'SUBMITTED' });
    expect(file).toMatchObject({ fileId: 'synthetic-file-01' });
    expect(resubmission).toMatchObject({ revision: 2, status: 'SUBMITTED' });
  });

  it('팀 만들기와 신청은 입력한 값을 되돌려 주고 다시 읽어도 남긴다', () => {
    // 새 신청을 내는 걸음은 「신청 전」 프로그램에서만 재현된다 — 이미 신청이 있는
    // 프로그램은 백엔드처럼 409 APP_011로 끝난다. 두 갈래는 세션 초기화로 나눈다.
    resetLocalReviewFixtureState();
    const team = jsonBody(
      callWithBody('student', 'POST', 'programs/program-basic-study/teams', {
        name: '합성 입력 팀',
      }),
    ) as { readonly id: string };
    const application = jsonBody(
      callWithBody(
        'student',
        'POST',
        'programs/program-basic-study/applications',
        {
          answers: { title: '합성 제목', summary: '합성 요약' },
          applicationTemplateVersion: 1,
          repositoryConnectionMode: 'OWN',
          repositoryUrl: 'https://github.com/team/repo',
        },
      ),
    );
    resetLocalReviewFixtureState();
    jsonBody(
      callWithBody('student', 'POST', 'programs/program-basic-study/teams', {
        name: '합성 기초팀',
      }),
    );
    const newRepositoryApplication = jsonBody(
      callWithBody(
        'student',
        'POST',
        'programs/program-basic-study/applications',
        {
          answers: { title: '합성 제목', summary: '합성 요약' },
          applicationTemplateVersion: 1,
          repositoryConnectionMode: 'NEW',
          repositoryUrl: null,
        },
      ),
    );

    expect(team).toMatchObject({ name: '합성 입력 팀' });
    expect(application).toMatchObject({
      repositoryConnectionMode: 'OWN',
      repositoryUrl: 'https://github.com/team/repo',
      teamId: team.id,
    });
    expect(newRepositoryApplication).toMatchObject({
      repositoryConnectionMode: 'NEW',
      repositoryUrl: null,
    });
  });

  it('신청 본문에 미허용 키 teamId 가 있으면 실제 backend 처럼 400 SYS_003 을 준다', () => {
    resetLocalReviewFixtureState();
    const plan = callWithBody(
      'student',
      'POST',
      'programs/program-basic-study/applications',
      {
        answers: { title: '합성 제목', summary: '합성 요약' },
        teamId: null,
        applicationTemplateVersion: 1,
        repositoryConnectionMode: 'NEW',
        repositoryUrl: null,
      },
    );

    expect(jsonBody(plan, 400)).toMatchObject({ code: 'SYS_003' });
  });

  it('creates a basic-study team then keeps GET teams/me and submitted application across reload', () => {
    resetLocalReviewFixtureState();
    expect(
      call('student', 'GET', 'programs/program-basic-study/teams/me'),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'TEAM_010' } });

    const created = jsonBody(
      callWithBody('student', 'POST', 'programs/program-basic-study/teams', {
        name: '합성 기초 오픈소스팀',
      }),
    ) as { readonly id: string };

    const roster = jsonBody(
      call('student', 'GET', 'programs/program-basic-study/teams/me'),
    ) as {
      readonly id: string;
      readonly name: string;
      readonly isLeader: boolean;
      readonly members: readonly {
        readonly userId: string;
        readonly isLeader: boolean;
      }[];
    };
    expect(roster).toMatchObject({
      id: created.id,
      name: '합성 기초 오픈소스팀',
      isLeader: true,
      memberCount: 1,
      // 만든 직후 — 팀장이라 초대할 수 있고, 혼자라 제외할 상대가 없고,
      // 신청 기록이 없어 그대로 나갈(=팀을 지울) 수 있다.
      hasApplication: false,
      canInvite: true,
      canRemoveMembers: false,
      canLeave: true,
    });
    expect(roster.members).toEqual([
      expect.objectContaining({
        userId: 'synthetic-user-01',
        isLeader: true,
      }),
    ]);
    expect(
      callWithBody('student', 'POST', 'programs/program-basic-study/teams', {
        name: '합성 다른 팀',
      }),
    ).toMatchObject({
      kind: 'json',
      status: 409,
      body: { code: 'TEAM_006' },
    });
    expect(
      callWithBody('student', 'POST', 'programs/program-basic-study/teams', {
        name: '   ',
      }),
    ).toMatchObject({
      kind: 'json',
      status: 400,
      body: { code: 'SYS_003' },
    });
    expect(
      callWithBody('student', 'POST', 'programs/missing-program/teams', {
        name: '합성 팀',
      }),
    ).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'TEAM_002' },
    });

    const submitted = jsonBody(
      call('student', 'POST', 'programs/program-basic-study/applications'),
    ) as { readonly teamId: string };
    expect(submitted.teamId).toBe(created.id);

    const mine = jsonBody(
      call('student', 'GET', 'programs/program-basic-study/applications/me'),
    ) as StudentApplication;
    expect(mine).toMatchObject({
      status: 'SUBMITTED',
      teamId: created.id,
      canCancel: true,
    });
    expect(
      (
        jsonBody(
          call('student', 'GET', 'programs/program-basic-study/viewer'),
        ) as ProgramDetail
      ).viewer.applicationStatus,
    ).toBe('SUBMITTED');
    // 제출해도 팀은 얼지 않는다 — 같은 팀이 그대로 남고 초대 권한도 유지된다.
    // 달라지는 것은 「신청 기록이 생겼고, 혼자라서 나갈 수 없다」만큼이다.
    expect(
      jsonBody(call('student', 'GET', 'programs/program-basic-study/teams/me')),
    ).toMatchObject({
      id: created.id,
      isLeader: true,
      memberCount: 1,
      hasApplication: true,
      canInvite: true,
      canRemoveMembers: false,
      canLeave: false,
    });
    // 마지막 구성원 + 신청 기록 = 탈퇴 불가. 신청을 먼저 취소해야 한다.
    expect(
      call('student', 'DELETE', 'programs/program-basic-study/teams/me'),
    ).toMatchObject({ kind: 'json', status: 409, body: { code: 'TEAM_012' } });

    expect(
      jsonBody(
        call(
          'student',
          'DELETE',
          'programs/program-basic-study/applications/me',
        ),
      ),
    ).toEqual({ cancelled: true });
    expect(
      call('student', 'GET', 'programs/program-basic-study/applications/me'),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'APP_001' } });
    expect(
      (
        jsonBody(
          call('student', 'GET', 'programs/program-basic-study/viewer'),
        ) as ProgramDetail
      ).viewer.applicationStatus,
    ).toBeNull();

    expect(
      jsonBody(
        call('student', 'DELETE', 'programs/program-basic-study/teams/me'),
      ),
    ).toEqual({});
    expect(
      call('student', 'GET', 'programs/program-basic-study/teams/me'),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'TEAM_010' } });
    expect(
      call('student', 'POST', 'programs/program-basic-study/applications'),
    ).toMatchObject({
      kind: 'json',
      status: 403,
      body: { code: 'APP_014' },
    });

    expect(
      jsonBody(
        call('student', 'GET', 'programs/program-sw-value/applications/me'),
      ),
    ).toMatchObject({ status: 'REJECTED', canCancel: false });
    expect(
      call('student', 'DELETE', 'programs/program-sw-value/applications/me'),
    ).toMatchObject({
      kind: 'json',
      status: 409,
      body: { code: 'APP_002' },
    });

    resetLocalReviewFixtureState();
    expect(
      call('student', 'GET', 'programs/program-basic-study/teams/me'),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'TEAM_010' } });
    expect(
      (
        jsonBody(
          call('student', 'GET', 'programs/program-capstone/teams/me'),
        ) as { readonly members: readonly unknown[] }
      ).members,
    ).toHaveLength(3);
  });
});

/**
 * 팀 구성원 생명주기(#1269)를 로컬 검토가 그대로 걸어 볼 수 있어야 한다 — 팀장의
 * 팀원 제외, 탈퇴와 자동 승계, 마지막 구성원 보호. 플래그를 픽스처가 지어내면
 * 검토자는 배포에서 403으로 막힐 버튼을 누르고 「로컬에선 됐는데」를 증거로 삼게 된다.
 *
 * 이 합성 상태는 화면 검토용이다 — 실제 GitHub 협업자 회수나 동시성 직렬화는
 * backend integration이 증명하며 여기서 흉내 내지 않는다.
 */
describe('team membership preview state', () => {
  const OTHER_MEMBER = {
    userId: 'synthetic-user-02',
    nickname: 'synthetic-contributor-02',
    name: '합성 팀원 A',
    isLeader: false,
  } as const;

  /** 세션에 직접 심는 합성 팀. 능력 플래그는 읽을 때 다시 계산된다. */
  function seedTeam(
    programId: string,
    overrides: Partial<ProgramTeam> & {
      readonly members: ProgramTeam['members'];
    },
  ): ProgramTeam {
    const team: ProgramTeam = {
      id: 'synthetic-team-seeded',
      name: '합성 공유팀',
      memberCount: overrides.members.length,
      minMembers: 1,
      maxMembers: 4,
      hasApplication: false,
      canInvite: false,
      canRemoveMembers: false,
      canLeave: true,
      isLeader: false,
      ...overrides,
    };
    rememberProgramTeam(programId, team);
    return team;
  }

  function myTeam(programId: string): ProgramTeam {
    return jsonBody(
      call('student', 'GET', `programs/${programId}/teams/me`),
    ) as ProgramTeam;
  }

  it('팀장의 팀원 제외는 명단을 줄이고 능력 플래그를 다시 계산하며 신청 이력은 그대로 둔다', () => {
    resetLocalReviewFixtureState();

    // Given: 고정 픽스처의 캡스톤팀 — 내가 팀장이고 셋이며 신청 기록이 있다.
    expect(myTeam('program-capstone')).toMatchObject({
      memberCount: 3,
      hasApplication: true,
      canInvite: true,
      canRemoveMembers: true,
      canLeave: true,
    });

    // When
    const removed = call(
      'student',
      'DELETE',
      'programs/program-capstone/teams/me/members/synthetic-user-02',
    );

    // Then
    expect(jsonBody(removed)).toEqual({});
    const afterFirst = myTeam('program-capstone');
    expect(afterFirst.members.map((member) => member.userId)).toEqual([
      'synthetic-user-01',
      'synthetic-user-03',
    ]);
    expect(afterFirst).toMatchObject({
      memberCount: 2,
      canRemoveMembers: true,
      canLeave: true,
    });

    // When: 마지막 팀원까지 제외하면 제외할 상대가 없어지고, 신청 기록 때문에 혼자는 나갈 수 없다.
    jsonBody(
      call(
        'student',
        'DELETE',
        'programs/program-capstone/teams/me/members/synthetic-user-03',
      ),
    );

    // Then
    expect(myTeam('program-capstone')).toMatchObject({
      memberCount: 1,
      hasApplication: true,
      canInvite: true,
      canRemoveMembers: false,
      canLeave: false,
    });
    // 제외는 명단만 바꾼다 — 이미 난 신청은 그대로 남는다.
    expect(
      jsonBody(
        call('student', 'GET', 'programs/program-capstone/applications/me'),
      ),
    ).toMatchObject({ status: 'APPROVED', teamId: 'synthetic-team-capstone' });
  });

  it('제외는 실제 도메인 코드로 거절한다 — 팀 없음·본인·이미 나간 대상·모르는 사람', () => {
    resetLocalReviewFixtureState();

    // Given / When / Then: 소속이 없으면 대상을 보기 전에 TEAM_010이다.
    expect(
      call(
        'student',
        'DELETE',
        'programs/program-basic-study/teams/me/members/synthetic-user-02',
      ),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'TEAM_010' } });

    // 본인 제외는 탈퇴(승계 포함)가 책임지므로 409다.
    expect(
      call(
        'student',
        'DELETE',
        `programs/program-capstone/teams/me/members/${currentSyntheticUserId()}`,
      ),
    ).toMatchObject({ kind: 'json', status: 409, body: { code: 'TEAM_014' } });

    // 모르는 사람과 「방금 제외해 이제 팀에 없는」 사람은 구분 없는 404다.
    jsonBody(
      call(
        'student',
        'DELETE',
        'programs/program-capstone/teams/me/members/synthetic-user-02',
      ),
    );
    for (const staleTarget of ['synthetic-user-02', 'synthetic-user-09']) {
      expect(
        call(
          'student',
          'DELETE',
          `programs/program-capstone/teams/me/members/${staleTarget}`,
        ),
      ).toMatchObject({
        kind: 'json',
        status: 404,
        body: { code: 'TEAM_015' },
      });
    }
  });

  it('팀장이 아닌 구성원은 명단도 신청도 바꿀 수 없다', () => {
    resetLocalReviewFixtureState();

    // Given: 초대를 받아 합류한 팀원 — 팀장은 다른 사람이다.
    seedTeam('program-basic-study', {
      id: 'synthetic-team-basic-shared',
      members: [
        { ...OTHER_MEMBER, isLeader: true },
        {
          userId: currentSyntheticUserId(),
          nickname: 'synthetic-contributor-01',
          name: '합성 합류자',
          isLeader: false,
        },
      ],
    });

    // When / Then: 팀장만 제외할 수 있고(TEAM_013), 팀 신청도 팀장만 낸다(APP_028).
    expect(myTeam('program-basic-study')).toMatchObject({
      isLeader: false,
      canInvite: false,
      canRemoveMembers: false,
      canLeave: true,
    });
    expect(
      call(
        'student',
        'DELETE',
        `programs/program-basic-study/teams/me/members/${OTHER_MEMBER.userId}`,
      ),
    ).toMatchObject({ kind: 'json', status: 403, body: { code: 'TEAM_013' } });
    expect(
      call('student', 'POST', 'programs/program-basic-study/applications'),
    ).toMatchObject({ kind: 'json', status: 403, body: { code: 'APP_028' } });
  });

  it('팀장이 나가면 팀은 남고, 나간 사람의 참여자 응답은 그 신청을 더 이상 드러내지 않는다', () => {
    resetLocalReviewFixtureState();

    // Given: 둘이고 내가 팀장인 팀으로 신청까지 냈다.
    seedTeam('program-basic-study', {
      id: 'synthetic-team-basic-shared',
      isLeader: true,
      members: [
        {
          userId: currentSyntheticUserId(),
          nickname: 'synthetic-contributor-01',
          name: '합성 팀장',
          isLeader: true,
        },
        OTHER_MEMBER,
      ],
    });
    jsonBody(
      call('student', 'POST', 'programs/program-basic-study/applications'),
    );
    expect(myTeam('program-basic-study')).toMatchObject({
      hasApplication: true,
      // 신청 기록이 있어도 혼자가 아니므로 나갈 수 있다.
      canLeave: true,
    });

    // When
    expect(
      jsonBody(
        call('student', 'DELETE', 'programs/program-basic-study/teams/me'),
      ),
    ).toEqual({});

    // Then: 나간 사람은 팀도, 그 팀이 낸 신청도 더 이상 보지 못한다.
    expect(
      call('student', 'GET', 'programs/program-basic-study/teams/me'),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'TEAM_010' } });
    expect(
      call('student', 'GET', 'programs/program-basic-study/applications/me'),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'APP_001' } });
    expect(
      (
        jsonBody(
          call('student', 'GET', 'programs/program-basic-study/viewer'),
        ) as ProgramDetail
      ).viewer.applicationStatus,
    ).toBeNull();
    // 참여자가 아니므로 제출 체크리스트도 백엔드와 같은 403 SUB_003이다.
    expect(
      call('student', 'GET', 'programs/program-basic-study/submissions/me'),
    ).toMatchObject({ kind: 'json', status: 403, body: { code: 'SUB_003' } });

    // 그리고 고정 픽스처가 나간 팀을 되살리지 않는다 — 새로 만든 팀은 다른 팀이고
    // 예전 신청을 자기 것으로 주장하지 않는다.
    const recreated = jsonBody(
      callWithBody('student', 'POST', 'programs/program-basic-study/teams', {
        name: '합성 새 팀',
      }),
    ) as { readonly id: string };
    expect(recreated.id).not.toBe('synthetic-team-basic-shared');
    expect(myTeam('program-basic-study')).toMatchObject({
      id: recreated.id,
      memberCount: 1,
      hasApplication: false,
      canInvite: true,
      canLeave: true,
    });
  });

  it('미제출 1인 팀의 탈퇴는 팀과 보낸 초대를 함께 정리한다', () => {
    resetLocalReviewFixtureState();
    const created = jsonBody(
      callWithBody('student', 'POST', 'programs/program-basic-study/teams', {
        name: '합성 단독팀',
      }),
    ) as { readonly id: string };
    // Given: 그 팀이 보낸 대기 중인 초대가 하나 있다.
    localReviewSessionState().sentInvitationsByTeam[created.id] = {
      'synthetic-invitation-pending-01': {
        id: 'synthetic-invitation-pending-01',
        teamId: created.id,
        programId: 'program-basic-study',
        invitedById: currentSyntheticUserId(),
        status: 'PENDING',
        invitedAt: '2026-08-01T00:00:00.000Z',
        respondedAt: null,
        invitee: {
          id: 'synthetic-user-04',
          nickname: 'synthetic-contributor-04',
          name: '합성 지원자 4',
          avatarUrl: null,
        },
      },
    };

    // When
    expect(
      jsonBody(
        call('student', 'DELETE', 'programs/program-basic-study/teams/me'),
      ),
    ).toEqual({});

    // Then: 팀이 사라졌으므로 남아 있는 초대도 없다(backend 도 팀 삭제 전에 초대를 지운다).
    expect(
      Object.values(
        localReviewSessionState().sentInvitationsByTeam[created.id] ?? {},
      ),
    ).toEqual([null]);
    expect(
      call('student', 'GET', 'programs/program-basic-study/teams/me'),
    ).toMatchObject({ kind: 'json', status: 404, body: { code: 'TEAM_010' } });
  });

  it('탈퇴 뒤 남는 명단은 팀장이 나갈 때만 첫 사람으로 승계한다', () => {
    // Given: 백엔드가 고르는 순서(합류 순) 그대로의 명단.
    const leader = {
      userId: currentSyntheticUserId(),
      nickname: 'synthetic-contributor-01',
      name: '합성 팀장',
      isLeader: true,
    } as const;
    const base: ProgramTeam = {
      id: 'synthetic-team-order',
      name: '합성 순서팀',
      memberCount: 3,
      minMembers: 1,
      maxMembers: 4,
      hasApplication: false,
      canInvite: true,
      canRemoveMembers: true,
      canLeave: true,
      isLeader: true,
      members: [
        leader,
        OTHER_MEMBER,
        {
          userId: 'synthetic-user-03',
          nickname: 'synthetic-contributor-03',
          name: null,
          isLeader: false,
        },
      ],
    };

    // When / Then: 팀장이 나가면 남은 명단의 첫 사람이 팀장이 된다.
    expect(rosterAfterLeave(base)).toEqual([
      { ...OTHER_MEMBER, isLeader: true },
      expect.objectContaining({
        userId: 'synthetic-user-03',
        isLeader: false,
      }),
    ]);

    // 팀원이 나가면 팀장은 그대로다.
    const asMember: ProgramTeam = {
      ...base,
      isLeader: false,
      members: [
        { ...OTHER_MEMBER, isLeader: true },
        {
          userId: currentSyntheticUserId(),
          nickname: 'synthetic-contributor-01',
          name: '합성 팀원',
          isLeader: false,
        },
      ],
    };
    expect(rosterAfterLeave(asMember)).toEqual([
      { ...OTHER_MEMBER, isLeader: true },
    ]);

    // 1인 팀은 빈 명단이다 — 팀 자체가 사라지는 갈래다.
    expect(
      rosterAfterLeave({ ...base, memberCount: 1, members: [leader] }),
    ).toEqual([]);
  });
});

describe('milestone submission item counts', () => {
  /*
    상세의 `submissionItemCount` 는 백엔드에서 짐작이 아니라 집계다 —
    `programs.service.ts` 의 `milestone._count.documents` 그 값이다. 하네스가 이
    불변식을 깨면 서비스에서는 생길 수 없는 화면이 나온다: 머리줄은 「제출 항목
    없음」이라 말하는데 그 아래 블록은 서류를 그린다.

    실제로 이 값이 0으로 굳어 있었고, 그 값으로만 갈리는 두 갈래 — 교직원 머리줄의
    「서류 수합」 입구, 학생 상세의 마일스톤 접기 — 를 로컬 검토가 통째로 못 보고
    지나갔다. 서류 픽스처와 상세 픽스처가 서로 다른 파일에 각자 적혀 있어(핸들러
    쪽 하나, 학생 동선 쪽 하나) 손으로 맞추면 또 어긋난다.
  */
  /*
    서류 조회는 역할이 정해진 사람만 할 수 있다(`unassigned`는 401). 역할이 없는
    사람은 애초에 이 불변식을 볼 수 없으므로 대상에서 뺀다.
  */
  const DOCUMENT_READING_FIXTURES = [
    ...STUDENT_FIXTURES,
    'staff',
    'admin',
  ] as const satisfies readonly LocalReviewFixtureId[];

  it.each(DOCUMENT_READING_FIXTURES)(
    '%s fixture reports the number of documents each milestone actually serves',
    (fixture) => {
      for (const programId of PUBLIC_PROGRAM_IDS) {
        // Given
        const detail = jsonBody(
          call(fixture, 'GET', `programs/${programId}/viewer`),
        ) as ProgramDetail;

        for (const milestone of detail.milestones) {
          // When
          /*
            목록은 배열이 아니라 **봉투**다 — `{ documents, fileUpload }`(#1107).
            배열로 받아 `.length` 를 읽으면 `undefined` 라, 어떤 값을 넣어도 맞지
            않는 검사가 된다(이 검사가 처음 CI에서 걸린 이유다).
          */
          const { documents } = jsonBody(
            call(fixture, 'GET', `milestones/${milestone.id}/documents`),
          ) as MilestoneDocumentList;

          // Then
          expect({
            milestone: milestone.id,
            count: milestone.submissionItemCount,
          }).toEqual({ milestone: milestone.id, count: documents.length });
        }
      }
    },
  );
});
