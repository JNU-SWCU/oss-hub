import { describe, expect, it } from 'vitest';
import type { ProgramActivity, ProgramDetail } from '@/features/programs/types';
import { resolveApplyBlockedReason } from '@/features/programs/program-apply-flow';
import { PROGRAM_TEMPLATE_DEFINITIONS } from '@/features/programs/program-templates';
import type { StudentApplication } from '@/features/programs/student-application-api';
import type { SubmissionFormData } from '@/features/submissions/types';
import type { LocalReviewFixtureId } from '@/lib/local-review-runtime';
import { resolveLocalReviewResponse } from '../fixture-response';
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
   * 참여자에게도 「승인 후」 잠금을 붙였던 것이 그 사고였다(#1099).
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
    // Given / When
    const withTeam = jsonBody(
      call('student', 'GET', 'programs/program-capstone/teams/me'),
    ) as { readonly members: readonly unknown[] };
    const withoutTeam = call(
      'student',
      'GET',
      'programs/program-oss-contest/teams/me',
    );

    // Then: 404는 화면에서 "팀 만들기·참여코드 합류" 화면으로 갈린다.
    expect(withTeam.members).toHaveLength(3);
    expect(withoutTeam).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'TEAM_010' },
    });
  });

  it('succeeds on every student action a screen can trigger', () => {
    // Given / When
    const application = jsonBody(
      call('student', 'POST', 'programs/program-basic-study/applications'),
    );
    const team = jsonBody(
      call('student', 'POST', 'programs/program-oss-contest/teams'),
    );
    const joined = jsonBody(
      call('student', 'POST', 'programs/program-oss-contest/teams/join'),
    );
    const submission = jsonBody(call('student', 'POST', 'submissions'));
    const file = jsonBody(call('student', 'POST', 'submission-files'));
    const resubmission = jsonBody(
      call('student', 'POST', 'submissions/submission-revision/resubmissions'),
    );

    // Then
    expect(application).toMatchObject({
      programId: 'program-basic-study',
      status: 'SUBMITTED',
    });
    expect(team).toMatchObject({ joinCode: 'FIXTURE01', memberCount: 1 });
    expect(joined).toMatchObject({ id: 'synthetic-team-joined' });
    expect(submission).toMatchObject({ status: 'SUBMITTED' });
    expect(file).toMatchObject({ fileId: 'synthetic-file-01' });
    // 체크리스트의 현재 revision(1) 다음 값이어야 성공 문구가 맞는다.
    expect(resubmission).toMatchObject({ revision: 2, status: 'SUBMITTED' });
  });

  it('팀 만들기와 신청은 입력한 값을 되돌려 준다', () => {
    // Given / When: 화면은 응답의 팀명을 그대로 명단에 그린다.
    const team = jsonBody(
      resolveLocalReviewResponse({
        fixture: 'student',
        method: 'POST',
        path: 'programs/program-oss-contest/teams',
        searchParams: new URLSearchParams(),
        body: { name: '합성 입력 팀' },
      }),
    );
    const application = jsonBody(
      resolveLocalReviewResponse({
        fixture: 'student',
        method: 'POST',
        path: 'programs/program-oss-contest/applications',
        searchParams: new URLSearchParams(),
        body: {
          answers: { title: '합성 제목', summary: '합성 요약' },
          applicationTemplateVersion: 1,
          repositoryConnectionMode: 'OWN',
          repositoryUrl: 'https://github.com/team/repo',
        },
      }),
    );
    const newRepositoryApplication = jsonBody(
      resolveLocalReviewResponse({
        fixture: 'student',
        method: 'POST',
        path: 'programs/program-basic-study/applications',
        searchParams: new URLSearchParams(),
        body: {
          answers: { title: '합성 제목', summary: '합성 요약' },
          applicationTemplateVersion: 1,
          repositoryConnectionMode: 'NEW',
          repositoryUrl: null,
        },
      }),
    );

    // Then
    expect(team).toMatchObject({ name: '합성 입력 팀' });
    expect(application).toMatchObject({
      repositoryConnectionMode: 'OWN',
      repositoryUrl: 'https://github.com/team/repo',
    });
    expect(newRepositoryApplication).toMatchObject({
      repositoryConnectionMode: 'NEW',
      repositoryUrl: null,
    });
  });

  it('신청 본문에 미허용 키 teamId 가 있으면 실제 backend 처럼 400 SYS_003 을 준다', () => {
    // 2026-08-05 회귀 재발 방지. 이 픽스처가 예전에는 teamId 를 그대로 에코해서,
    // frontend 가 미허용 키를 보내는 동안에도 로컬 검토가 성공처럼 보였다.
    // 픽스처가 실제 계약보다 너그러우면 검토가 결함을 통과시킨다.
    const plan = resolveLocalReviewResponse({
      fixture: 'student',
      method: 'POST',
      path: 'programs/program-basic-study/applications',
      searchParams: new URLSearchParams(),
      body: {
        answers: { title: '합성 제목', summary: '합성 요약' },
        teamId: null,
        applicationTemplateVersion: 1,
        repositoryConnectionMode: 'NEW',
        repositoryUrl: null,
      },
    });

    expect(jsonBody(plan, 400)).toMatchObject({ code: 'SYS_003' });
  });
});
