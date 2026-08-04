import { describe, expect, it } from 'vitest';
import { toProgramEditForm } from '@/features/programs/program-edit-flow';
import type { EditableProgram } from '@/features/programs/api';
import type { ApplicationListPage } from '@/features/programs/types';
import { cellForMilestone } from '@/features/submissions/matrix';
import type { SubmissionMatrixPage } from '@/features/submissions/types';
import type { ReviewContext } from '@/features/reviews/types';
import type { LocalReviewFixtureId } from '../fixture-contract';
import {
  isAuthenticatedFixture,
  roleForFixture,
  type LocalReviewContext,
  type LocalReviewResponsePlan,
} from '../handler-kit';
import { STAFF_HANDLERS } from './staff-handlers';

/**
 * 교직원 대시보드 픽스처(`STAFF_DASHBOARD_FIXTURE`)가 카드에서 바로 연결하는
 * 프로그램 id. 이 값이 어긋나면 대시보드 → 신청자 목록 링크가 404로 떨어진다.
 */
const DASHBOARD_PROGRAM_IDS = ['program-basic-study', 'program-capstone'];

function contextFor(
  method: string,
  path: string,
  search = '',
  fixture: LocalReviewFixtureId = 'staff',
): LocalReviewContext {
  return {
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(search),
    role: roleForFixture(fixture),
    isAuthenticated: isAuthenticatedFixture(fixture),
  };
}

function resolve(
  method: string,
  path: string,
  search = '',
  fixture: LocalReviewFixtureId = 'staff',
): LocalReviewResponsePlan | null {
  const context = contextFor(method, path, search, fixture);
  for (const handler of STAFF_HANDLERS) {
    const plan = handler(context);
    if (plan !== null) return plan;
  }
  return null;
}

/** 승인·반려처럼 요청 본문에만 있는 입력을 그대로 실어 보낸다. */
function resolveWithBody(
  method: string,
  path: string,
  body: unknown,
  fixture: LocalReviewFixtureId = 'staff',
): LocalReviewResponsePlan | null {
  const context: LocalReviewContext = {
    ...contextFor(method, path, '', fixture),
    body,
  };
  for (const handler of STAFF_HANDLERS) {
    const plan = handler(context);
    if (plan !== null) return plan;
  }
  return null;
}

function bodyOf<T>(plan: LocalReviewResponsePlan | null, status = 200): T {
  if (plan === null) throw new Error('expected a staff fixture plan');
  if (plan.kind !== 'json') throw new Error('expected a json fixture plan');
  expect(plan.status).toBe(status);
  return plan.body as T;
}

describe('staff local review handlers', () => {
  it.each(DASHBOARD_PROGRAM_IDS)(
    '대시보드 카드가 가리키는 %s 의 신청자 목록이 응답한다',
    (programId) => {
      // Given / When
      const page = bodyOf<ApplicationListPage>(
        resolve(
          'GET',
          `programs/${programId}/applications`,
          'page=1&pageSize=20&search=&status=all&mode=all',
        ),
      );

      // Then
      expect(page.page).toBe(1);
      expect(page.items.length).toBe(page.totalItems);
    },
  );

  it('프로그램 상세는 학생 동선 핸들러가 맡으므로 여기서는 응답하지 않는다', () => {
    // Given / When — 같은 경로를 두 곳에서 다루면 뒤쪽 규칙이 죽은 코드가 된다.
    const plan = resolve('GET', 'programs/program-basic-study/viewer');

    // Then
    expect(plan).toBeNull();
  });

  it('기초 스터디 신청 집계는 대시보드 카드(전체 3·제출 1·승인 1·반려 1)와 같다', () => {
    // Given / When
    const page = bodyOf<ApplicationListPage>(
      resolve(
        'GET',
        'programs/program-basic-study/applications',
        'page=1&pageSize=20&search=&status=all&mode=all',
      ),
    );

    // Then
    const counted = (status: string) =>
      page.items.filter((item) => item.status === status).length;
    expect(page.totalItems).toBe(3);
    expect(counted('SUBMITTED')).toBe(1);
    expect(counted('APPROVED')).toBe(1);
    expect(counted('REJECTED')).toBe(1);
  });

  it('신청자 목록은 상태·검색 질의를 반영하고 mode는 무시한다', () => {
    // Given / When
    const submitted = bodyOf<ApplicationListPage>(
      resolve(
        'GET',
        'programs/program-basic-study/applications',
        'page=1&pageSize=20&search=&status=SUBMITTED',
      ),
    );
    const withLegacyMode = bodyOf<ApplicationListPage>(
      resolve(
        'GET',
        'programs/program-basic-study/applications',
        'page=1&pageSize=20&search=&status=all&mode=team',
      ),
    );
    const withoutMode = bodyOf<ApplicationListPage>(
      resolve(
        'GET',
        'programs/program-basic-study/applications',
        'page=1&pageSize=20&search=&status=all',
      ),
    );
    const searched = bodyOf<ApplicationListPage>(
      resolve(
        'GET',
        'programs/program-oss-contest/applications',
        'page=1&pageSize=20&search=챔피언&status=all',
      ),
    );

    // Then
    expect(submitted.items.map((item) => item.id)).toEqual([
      'application-basic-submitted',
    ]);
    // D6: mode 필터 폐지 — 구 클라이언트의 mode 값은 결과 집합을 바꾸지 않는다.
    expect(withLegacyMode.totalItems).toBe(withoutMode.totalItems);
    expect(withLegacyMode.items.map((item) => item.id)).toEqual(
      withoutMode.items.map((item) => item.id),
    );
    expect(searched.items.map((item) => item.id)).toEqual([
      'application-contest-champion',
    ]);
  });

  it('프로그램 편집 응답은 편집 폼이 그대로 읽을 수 있는 모양이다', () => {
    // Given / When
    const program = bodyOf<EditableProgram>(
      resolve('GET', 'programs/program-basic-study/edit'),
    );
    const form = toProgramEditForm(program);

    // Then — 종료일은 신청 종료일·모든 마일스톤 마감 이후여야 저장이 통과한다.
    expect(form.name).toBe('합성 기초 오픈소스 스터디');
    expect(program.endAt).not.toBeNull();
    expect(program.endAt! > program.applicationEndAt).toBe(true);
    expect(
      program.milestones.every((milestone) => program.endAt! > milestone.dueAt),
    ).toBe(true);
  });

  it('매트릭스 행의 신청 id는 같은 프로그램 신청자 목록에 실제로 있다', () => {
    // Given
    const matrix = bodyOf<SubmissionMatrixPage>(
      resolve(
        'GET',
        'programs/program-oss-contest/submissions/matrix',
        'page=1&pageSize=20',
      ),
    );
    const page = bodyOf<ApplicationListPage>(
      resolve(
        'GET',
        'programs/program-oss-contest/applications',
        'page=1&pageSize=20&search=&status=all&mode=all',
      ),
    );

    // When
    const applicationIds = page.items.map((item) => item.id);

    // Then — 매트릭스 행은 승인된 Application이다(#124 계약).
    expect(matrix.rows.length).toBeGreaterThan(0);
    expect(
      matrix.rows.every((row) => applicationIds.includes(row.applicationId)),
    ).toBe(true);
    expect(matrix.milestones.map((milestone) => milestone.id)).toEqual([
      'milestones-overdue',
      'milestones-contest-final',
    ]);
  });

  it('매트릭스 셀의 검토 링크를 따라가면 검토 컨텍스트가 실제로 있다', () => {
    // Given
    const matrix = bodyOf<SubmissionMatrixPage>(
      resolve(
        'GET',
        'programs/program-basic-study/submissions/matrix',
        'page=1&pageSize=20',
      ),
    );
    const cells = matrix.rows.flatMap((row) =>
      matrix.milestones.map((milestone) => cellForMilestone(row, milestone.id)),
    );
    const submitted = cells.filter((cell) => cell.reviewUrl !== null);

    // When
    const contexts = submitted.map((cell) =>
      bodyOf<ReviewContext>(
        resolve('GET', `submissions/${cell.submissionId}/review-context`),
      ),
    );

    // Then — 링크의 제출 id가 검토 화면 응답의 제출 id와 같아야 끝까지 이어진다.
    expect(submitted.length).toBeGreaterThan(0);
    expect(contexts.map((context) => context.submissionId)).toEqual(
      submitted.map((cell) => cell.submissionId),
    );
    expect(
      submitted.every(
        (cell) =>
          cell.reviewUrl ===
          `/programs/program-basic-study/submissions/${cell.submissionId}/review`,
      ),
    ).toBe(true);
  });

  it('아직 판정이 없는 제출은 검토 폼을 눌러 볼 수 있도록 review가 비어 있다', () => {
    // Given / When
    const context = bodyOf<ReviewContext>(
      resolve('GET', 'submissions/submission-basic-final/review-context'),
    );

    // Then
    expect(context.application.id).toBe('application-basic-approved');
    expect(context.currentRevision.review).toBeNull();
  });

  it('없는 제출은 검토 화면이 갈리도록 404를 준다', () => {
    // Given / When
    const plan = resolve('GET', 'submissions/synthetic-missing/review-context');

    // Then
    expect(plan).toMatchObject({
      kind: 'json',
      status: 404,
      body: { code: 'SUB_001' },
    });
  });

  it('프로그램 등록 응답의 detailUrl이 가리키는 화면이 실제로 응답한다', () => {
    // Given
    const created = bodyOf<{
      readonly id: string;
      readonly detailUrl: string;
    }>(resolve('POST', 'programs'));

    // When — 등록 직후 화면은 detailUrl로 이동한다.
    const program = bodyOf<EditableProgram>(
      resolve('GET', `programs/${created.id}/edit`),
    );

    // Then
    expect(created.detailUrl).toBe(`/programs/${created.id}/edit`);
    expect(program.id).toBe(created.id);
    // 마일스톤이 없어 제출 현황 화면의 "마일스톤 없음" 상태를 확인할 수 있다.
    expect(program.milestones).toHaveLength(0);
  });

  it('신청 반려는 반려로, 승인은 승인으로 돌아온다', () => {
    // Given: 화면은 `{ action }`(REJECT는 사유까지) 를 보낸다.
    const applicationId = 'application-basic-submitted';

    // When
    const approved = bodyOf<{
      readonly status: string;
      readonly repositoryProvisioning?: unknown;
    }>(
      resolveWithBody('PATCH', `applications/${applicationId}`, {
        action: 'APPROVE',
      }),
    );
    const rejected = bodyOf<{
      readonly status: string;
      readonly rejectionReason?: string;
      readonly repositoryProvisioning?: unknown;
    }>(
      resolveWithBody('PATCH', `applications/${applicationId}`, {
        action: 'REJECT',
        reason: '합성 반려 사유',
      }),
    );

    // Then — 반려 응답에는 저장소 작업이 없고 입력한 사유가 담긴다.
    expect(approved.status).toBe('APPROVED');
    expect(approved.repositoryProvisioning).toMatchObject({
      jobStatus: 'SUCCEEDED',
    });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('합성 반려 사유');
    expect(rejected.repositoryProvisioning).toBeUndefined();
  });
  it('신청 되돌리기는 SUBMITTED로 돌아온다', () => {
    // Given
    const applicationId = 'application-basic-rejected';

    // When
    const reverted = bodyOf<{
      readonly status: string;
      readonly rejectionReason?: string;
      readonly repositoryProvisioning?: unknown;
    }>(
      resolveWithBody('PATCH', `applications/${applicationId}`, {
        action: 'REVERT',
      }),
    );

    // Then
    expect(reverted.status).toBe('SUBMITTED');
    expect(reverted.rejectionReason).toBeUndefined();
    expect(reverted.repositoryProvisioning).toBeUndefined();
  });

  it('프로그램 등록은 고른 유형과 그 유형의 신청 양식을 돌려준다', () => {
    // Given / When
    const created = bodyOf<{
      readonly category: string;
      readonly applicationTemplateKey: string;
    }>(
      resolveWithBody('POST', 'programs', {
        name: '합성 캡스톤 신규',
        category: 'CAPSTONE',
      }),
    );

    // Then
    expect(created.category).toBe('CAPSTONE');
    expect(created.applicationTemplateKey).toBe('capstone');
  });

  it('프로그램 수정은 입력한 이름·주최를 되돌려 준다', () => {
    // Given / When
    const updated = bodyOf<EditableProgram>(
      resolveWithBody('PATCH', 'programs/program-basic-study', {
        name: '합성 이름 변경',
        organizer: '합성 주최 변경',
      }),
    );

    // Then — 편집 화면은 이 응답으로 폼을 다시 채운다.
    expect(updated.name).toBe('합성 이름 변경');
    expect(updated.organizer).toBe('합성 주최 변경');
    // 본문에 없는 값은 픽스처를 유지한다.
    expect(updated.id).toBe('program-basic-study');
    expect(updated.milestones.length).toBeGreaterThan(0);
  });

  it('마일스톤 저장은 입력한 이름·마감·제출 형식을 되돌려 준다', () => {
    // Given
    const input = {
      name: '합성 마일스톤 입력',
      dueAt: '2026-11-30T14:59:59.000Z',
      submissionType: 'FILE',
      instructions: '합성 안내',
    };

    // When
    const created = bodyOf<{
      readonly name: string;
      readonly dueAt: string;
      readonly submissionType: string;
    }>(
      resolveWithBody('POST', 'programs/program-basic-study/milestones', input),
    );
    const updated = bodyOf<{ readonly id: string; readonly name: string }>(
      resolveWithBody('PATCH', 'milestones/milestone-basic-final', input),
    );

    // Then
    expect(created.name).toBe('합성 마일스톤 입력');
    expect(created.dueAt).toBe('2026-11-30T14:59:59.000Z');
    expect(created.submissionType).toBe('FILE');
    expect(updated.id).toBe('milestone-basic-final');
    expect(updated.name).toBe('합성 마일스톤 입력');
  });

  it('마일스톤 안내를 비우면 비운 채로 돌아온다', () => {
    // Given / When: 화면은 빈 안내를 `null`로 보낸다(buildMilestoneInput).
    const created = bodyOf<{ readonly instructions: string | null }>(
      resolveWithBody('POST', 'programs/program-basic-study/milestones', {
        name: '합성 마일스톤',
        dueAt: '2026-11-30T14:59:59.000Z',
        submissionType: 'TEXT',
        instructions: null,
      }),
    );

    // Then — 안 보낸 경우(합성 기본 안내)와 구분돼야 한다.
    expect(created.instructions).toBeNull();
  });

  it('제출물 검토는 고른 판정을 그대로 돌려준다', () => {
    // Given / When
    const changes = bodyOf<{ readonly submissionStatus: string }>(
      resolveWithBody('POST', 'submissions/submission-basic-final/reviews', {
        revision: 1,
        decision: 'CHANGES_REQUESTED',
        comment: '합성 보완 요청',
      }),
    );
    const approved = bodyOf<{ readonly submissionStatus: string }>(
      resolveWithBody('POST', 'submissions/submission-basic-final/reviews', {
        revision: 1,
        decision: 'APPROVED',
      }),
    );

    // Then
    expect(changes.submissionStatus).toBe('CHANGES_REQUESTED');
    expect(approved.submissionStatus).toBe('APPROVED');
  });

  it.each([
    ['PATCH', 'programs/program-basic-study'],
    ['POST', 'programs/program-basic-study/milestones'],
    ['PATCH', 'milestones/milestone-basic-final'],
    ['DELETE', 'milestones/milestone-basic-final'],
    ['PATCH', 'applications/application-basic-submitted'],
    ['POST', 'submissions/submission-basic-final/reviews'],
    ['POST', 'repositories/synthetic-repo-contest-02/publish'],
  ])('교직원 조작 %s %s 은 200으로 답한다', (method, path) => {
    // Given / When
    const plan = resolve(method, path);

    // Then
    expect(plan).toMatchObject({ kind: 'json', status: 200 });
  });

  it('마일스톤 삭제는 화면이 기대하는 deleted 플래그를 준다', () => {
    // Given / When
    const body = bodyOf<{ readonly deleted: true }>(
      resolve('DELETE', 'milestones/milestone-basic-final'),
    );

    // Then
    expect(body).toEqual({ deleted: true });
  });

  it('관리자 페르소나도 교직원 화면 응답을 받는다', () => {
    // Given / When
    const program = bodyOf<EditableProgram>(
      resolve('GET', 'programs/program-basic-study/edit', '', 'admin'),
    );

    // Then
    expect(program.id).toBe('program-basic-study');
  });

  it.each([
    'programs/program-basic-study/edit',
    'programs/program-basic-study/applications',
    'programs/program-basic-study/submissions/matrix',
    'submissions/submission-basic-final/review-context',
  ])('권한 없는 페르소나에는 %s 를 응답하지 않는다', (path) => {
    // Given / When
    const student = resolve('GET', path, '', 'student');
    const anonymous = resolve('GET', path, '', 'anonymous');

    // Then — null이면 기본 404로 떨어진다.
    expect(student).toBeNull();
    expect(anonymous).toBeNull();
  });

  it('권한 없는 페르소나는 교직원 조작도 할 수 없다', () => {
    // Given / When
    const create = resolve('POST', 'programs', '', 'student');
    const remove = resolve(
      'DELETE',
      'milestones/milestone-basic-final',
      '',
      'student',
    );

    // Then
    expect(create).toBeNull();
    expect(remove).toBeNull();
  });
});
