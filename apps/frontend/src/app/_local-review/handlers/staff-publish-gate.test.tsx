// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EditableProgram } from '@/features/programs/api';
import type { ApplicationListItem } from '@/features/programs/types';
import { SubmissionReviewView } from '@/features/reviews/components/submission-review-view';
import type {
  PublishBlockedReason,
  ReviewContext,
} from '@/features/reviews/types';
import type {
  MatrixRow,
  SubmissionMatrixPage,
} from '@/features/submissions/types';
import type { LocalReviewFixtureId } from '../fixture-contract';
import {
  isAuthenticatedFixture,
  roleForFixture,
  type LocalReviewContext,
  type LocalReviewResponsePlan,
} from '../handler-kit';
import { STAFF_HANDLERS } from './staff-handlers';
import {
  STAFF_PROGRAM_FIXTURES,
  STAFF_REVIEW_CONTEXTS,
} from './staff-program-fixtures';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function resolve(
  method: string,
  path: string,
  search = '',
  fixture: LocalReviewFixtureId = 'staff',
): LocalReviewResponsePlan | null {
  const context: LocalReviewContext = {
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(search),
    role: roleForFixture(fixture),
    isAuthenticated: isAuthenticatedFixture(fixture),
  };
  for (const handler of STAFF_HANDLERS) {
    const plan = handler(context);
    if (plan !== null) return plan;
  }
  return null;
}

function bodyOf<T>(plan: LocalReviewResponsePlan | null): T {
  if (plan === null || plan.kind !== 'json' || plan.status !== 200) {
    throw new Error('expected a 200 json fixture plan');
  }
  return plan.body as T;
}

interface ApplicationSource {
  readonly program: EditableProgram;
  readonly application: ApplicationListItem;
  readonly matrixRow: MatrixRow | null;
}

function sourceFor(applicationId: string): ApplicationSource {
  for (const fixture of STAFF_PROGRAM_FIXTURES) {
    const application = fixture.applications.find(
      (item) => item.id === applicationId,
    );
    if (application === undefined) continue;
    return {
      program: fixture.program,
      application,
      matrixRow:
        fixture.matrixRows.find((row) => row.applicationId === applicationId) ??
        null,
    };
  }
  throw new Error(`검토 컨텍스트가 없는 신청을 가리킨다: ${applicationId}`);
}

/**
 * 백엔드 `publishBlockedReasons`(submission-reviews/domain/submission-review.ts)를
 * 픽스처 **재료**에서 다시 계산한다. 사유 순서도 서버 순서 그대로다.
 *
 * 검토 컨텍스트에 손으로 적어 둔 `blockedReasons`를 그대로 읽으면 "적힌 것이 사실인지"는
 * 아무도 보지 않는다 — #752 이전에 하네스가 서버는 거절할 자리를 "공개 가능"으로 열어
 * 두고 있었던 이유가 그것이다.
 */
function derivedBlockedReasons(
  context: ReviewContext,
  now: Date,
): readonly PublishBlockedReason[] {
  const repository = context.repository;
  // 이미 공개된 저장소는 게이트 대상이 아니다(서버와 같은 가드).
  if (repository === null || repository.visibility !== 'PRIVATE') return [];
  const { program, application, matrixRow } = sourceFor(context.application.id);
  const statusByMilestone = new Map(
    (matrixRow?.cells ?? []).map((cell) => [cell.milestoneId, cell.status]),
  );
  return [
    ...(application.repositoryProvisioning.jobStatus === 'SUCCEEDED'
      ? []
      : (['REPOSITORY_NOT_READY'] as const)),
    ...(application.isRepositoryPublicationPlanned
      ? []
      : (['REPOSITORY_PUBLICATION_NOT_PLANNED'] as const)),
    // ⚠ `endAt === null`은 미종료라 차단이다(`Program.endAt` 스키마 주석, #264).
    ...(program.endAt !== null && Date.parse(program.endAt) <= now.getTime()
      ? []
      : (['PROGRAM_NOT_ENDED'] as const)),
    ...(program.milestones.every(
      (milestone) => statusByMilestone.get(milestone.id) === 'APPROVED',
    )
      ? []
      : (['REQUIRED_MILESTONES_NOT_APPROVED'] as const)),
  ];
}

const REVIEW_CONTEXT_IDS = Object.keys(STAFF_REVIEW_CONTEXTS);

function publishableContexts(now: Date): readonly ReviewContext[] {
  return Object.values(STAFF_REVIEW_CONTEXTS).filter(
    (context) =>
      context.repository?.visibility === 'PRIVATE' &&
      derivedBlockedReasons(context, now).length === 0,
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const noOp = () => undefined;

function renderReview(context: ReviewContext): void {
  act(() => {
    root.render(
      <SubmissionReviewView
        context={context}
        decision=""
        comment=""
        isSaving={false}
        isPublishing={false}
        formError={null}
        notice={null}
        publishError={null}
        onDecisionChange={noOp}
        onCommentChange={noOp}
        onSave={noOp}
        onCancel={noOp}
        onPublish={noOp}
      />,
    );
  });
}

function publishButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    (candidate.textContent ?? '').includes('공개 전환'),
  );
  if (button === undefined) throw new Error('공개 전환 버튼을 찾지 못했다');
  return button;
}

describe('교직원 검토 픽스처의 저장소 공개 게이트', () => {
  it.each(REVIEW_CONTEXT_IDS)(
    '%s 의 차단 사유는 신청·프로그램·제출 현황에서 실제로 파생된다',
    (submissionId) => {
      // Given: 하네스가 검토 화면에 주는 컨텍스트.
      const context = bodyOf<ReviewContext>(
        resolve('GET', `submissions/${submissionId}/review-context`),
      );

      // When: 같은 픽스처의 재료로 서버 게이트를 다시 계산한다.
      const derived = derivedBlockedReasons(context, new Date());

      // Then: 적어 둔 사유가 재료와 같고, 적격 여부도 그 사유에서 나온다.
      expect(context.repository?.blockedReasons ?? []).toEqual(derived);
      expect(context.repository?.publishEligible ?? false).toBe(
        derived.length === 0,
      );
    },
  );

  it('저장소 공개를 실제로 눌러 볼 수 있는 검토 컨텍스트가 있다', () => {
    // Given / When: 네 게이트를 전부 지나는 비공개 저장소를 찾는다.
    const publishable = publishableContexts(new Date());

    // Then: 하나도 없으면 하네스에서 공개 전환을 눌러 볼 자리가 없다(#753).
    expect(publishable.length).toBeGreaterThan(0);
  });

  it('공개 가능한 컨텍스트는 제출 현황 표의 검토 링크를 타고 닿는다', () => {
    // Given: 공개를 눌러 볼 수 있는 제출.
    const [context] = publishableContexts(new Date());
    if (context === undefined) throw new Error('공개 가능한 컨텍스트가 없다');
    const { program } = sourceFor(context.application.id);

    // When: 교직원이 그 프로그램의 제출 현황 표를 연다.
    const matrix = bodyOf<SubmissionMatrixPage>(
      resolve(
        'GET',
        `programs/${program.id}/submissions/matrix`,
        'page=1&pageSize=20',
      ),
    );
    const cell = matrix.rows
      .flatMap((row) => row.cells)
      .find((candidate) => candidate.submissionId === context.submissionId);

    // Then: 표의 칸에서 검토 화면으로 이어진다 — 주소를 손으로 적어야만 닿으면
    // "눌러 볼 자리"가 아니다.
    expect(cell?.reviewUrl).toBe(
      `/programs/${program.id}/submissions/${context.submissionId}/review`,
    );
  });

  it('검토 화면이 그 컨텍스트에 공개 전환 버튼을 열어 준다', () => {
    // Given: 하네스가 실제로 응답하는 컨텍스트를 그대로 화면에 넣는다.
    const [publishable] = publishableContexts(new Date());
    if (publishable === undefined)
      throw new Error('공개 가능한 컨텍스트가 없다');
    const context = bodyOf<ReviewContext>(
      resolve('GET', `submissions/${publishable.submissionId}/review-context`),
    );

    // When: 교직원이 검토 화면을 본다.
    renderReview(context);

    // Then: 버튼이 눌린다 — 화면까지 와서 비활성이면 여전히 눌러 볼 자리가 없다.
    expect(publishButton().disabled).toBe(false);
  });
});
