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
import type { LocalReviewFixtureId } from '@/lib/local-review-runtime';
import {
  isAuthenticatedFixture,
  roleForFixture,
  type LocalReviewContext,
  type LocalReviewResponsePlan,
} from '../handler-kit';
import { STAFF_HANDLERS } from './staff-handlers';
import {
  PROGRAM_NEVER_ENDS_AT,
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
 * 백엔드 `publishBlockedReasons`(common/repository-publication.ts)를
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

/**
 * 「끝나지 않는 프로그램」 바로 앞 순간이다. 미종료를 나타내는 유일한 값인
 * `PROGRAM_NEVER_ENDS_AT`에서 파생시켰으므로, 그보다 이른 종료일은 **전부** 이 시각에
 * 이미 지나간 것이 된다.
 *
 * 지금 시각과 달력 끝 **두 번** 대조해서, 달력이 흐른다고 판정이 달라지는 픽스처를
 * 그 자리에서 RED 로 만든다(#812).
 *
 * ⚠ 시각을 고정(freeze)하지 않는다. 잡아내는 범위만 보면 고정해도 같다 — 아래 대조가
 * 이미 `endAt ∈ (지금, END_OF_CALENDAR]` 를 전부 걸러 내므로 `new Date()` 가 검출력을
 * 더 주지는 않는다. 고정하지 않는 이유는 다른 데 있다: **이 픽스처는 실제 브라우저에
 * 진짜 시계로 서빙된다.** 검토자가 화면에서 보는 것과 테스트가 보는 것이 갈리면,
 * 테스트는 초록인데 화면은 다른 말을 하는 상태가 만들어진다.
 */
const END_OF_CALENDAR = new Date(Date.parse(PROGRAM_NEVER_ENDS_AT) - 1);

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
  it('미종료 센티널은 달력이 닿을 수 없는 값이다', () => {
    // Given / When: 하네스가 「안 끝나는 프로그램」에 쓰는 종료일.

    // Then: 4자리 연도로 적을 수 있는 마지막 순간이며, 백엔드 `Program.endAt` 컬럼의
    // DB 기본값(`9999-12-31 23:59:59.999`, `apps/backend/prisma/schema.prisma`)과 같은
    // 자리다. 위의 `END_OF_CALENDAR`가 이 값에서 파생되므로 여기를 낮춰 잡으면 대조
    // 기준도 같이 내려가 아무도 못 잡는다 — 그래서 값 자체를 못으로 박아 둔다(#812).
    expect(PROGRAM_NEVER_ENDS_AT).toBe('9999-12-31T23:59:59.999Z');
  });

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

      // And: 달력이 끝까지 흘러도 같은 판정이다. 종료일이 언젠가 지나가 버리는
      // 픽스처는 그 날 CI 를 처음 돌린 사람에게 남의 실패로 떨어지므로(#812),
      // 되돌려 적는 순간 여기서 잡는다.
      expect(context.repository?.blockedReasons ?? []).toEqual(
        derivedBlockedReasons(context, END_OF_CALENDAR),
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
