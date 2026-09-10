import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  lockSubmissionMembership,
  SubmissionMembershipChangedError,
} from '../submissions/submission-membership.repository';
import { upsertMilestoneDocumentSubmission } from './milestone-document-submission.repository';
import type { UpsertMilestoneDocumentSubmissionInput } from './milestone-documents.repository';

jest.mock('../submissions/submission-membership.repository', () => {
  const actual = jest.requireActual<
    typeof import('../submissions/submission-membership.repository')
  >('../submissions/submission-membership.repository');
  return { ...actual, lockSubmissionMembership: jest.fn() };
});

const lockMembership = jest.mocked(lockSubmissionMembership);

// 합성 데이터만 사용한다 (docs/rules/security.md)
const DOCUMENT_ID = 'cuid-synthetic-document';
const APPLICATION_ID = 'cuid-synthetic-application';
const MILESTONE_ID = 'cuid-synthetic-milestone';
const CURRENT_MEMBER_ID = 'cuid-synthetic-current-member';
const DEPARTED_MEMBER_ID = 'cuid-synthetic-departed-member';
const FILE_ID = 'cuid-synthetic-pending-file';
const SUBMISSION_ID = 'cuid-synthetic-submission';
const HISTORY_ID = 'cuid-synthetic-history';
const NOW = new Date('2026-09-16T14:22:00.000Z');
/** 마감(= NOW) 뒤 재제출 — 잠금 아래 제출 상태 재확인까지 지나는 가장 긴 경로다. */
const AFTER_DEADLINE = new Date('2026-09-16T14:22:01.000Z');

type Harness = Readonly<{
  prisma: PrismaService;
  /** 트랜잭션 안에서 실제로 실행된 문장을 순서대로 쌓는다. */
  order: readonly string[];
  transaction: unknown;
  upsert: jest.Mock;
  historyCreate: jest.Mock;
  attachUpdateMany: jest.Mock;
  queryRaw: jest.Mock;
}>;

function tableOf(sql: Prisma.Sql): string {
  return /FROM "(\w+)"/.exec(sql.sql)?.[1] ?? sql.sql;
}

/**
 * 실제 쓰기 경로와 같은 호출을 흉내 내는 트랜잭션 클라이언트. 공용 관문은 목이므로 여기서
 * `Program`·`Team` 잠금은 일어나지 않고, 대신 **관문이 언제 불렸는지**를 순서로 남긴다.
 */
function buildHarness(
  options: Readonly<{
    revision?: number;
    attachedCount?: number;
    /** 잠금 뒤 되읽은 현재 소속. 기본은 「지금도 팀원」. */
    member?: boolean;
  }> = {},
): Harness {
  const revision = options.revision ?? 1;
  const stillMember = options.member ?? true;
  const order: string[] = [];

  lockMembership.mockImplementation(() => {
    order.push('fence:membership');
    return Promise.resolve(stillMember);
  });

  const queryRaw = jest.fn((sql: Prisma.Sql) => {
    const table = tableOf(sql);
    order.push(`lock:${table}`);
    if (table === 'Milestone') return Promise.resolve([{ dueAt: NOW }]);
    if (table === 'MilestoneDocument')
      return Promise.resolve([{ id: DOCUMENT_ID }]);
    throw new Error(`예상하지 못한 잠금 대상: ${table}`);
  });

  const historyFindFirst = jest.fn(() => {
    order.push('read:latestHistory');
    return Promise.resolve(null);
  });
  const reviewFindFirst = jest.fn(() => {
    order.push('read:latestReview');
    return Promise.resolve(null);
  });
  const submissionFindUnique = jest.fn(() => {
    order.push('read:currentSubmission');
    return Promise.resolve({ status: SubmissionStatus.CHANGES_REQUESTED });
  });
  const upsert = jest.fn((args: { update: { submittedById: string } }) => {
    order.push('write:submission');
    return Promise.resolve({
      id: SUBMISSION_ID,
      status: SubmissionStatus.SUBMITTED,
      content: { type: 'TEXT', text: '본문' },
      submittedAt: NOW,
      revision,
      submittedById: args.update.submittedById,
    });
  });
  const historyCreate = jest.fn(() => {
    order.push('write:history');
    return Promise.resolve({ id: HISTORY_ID });
  });
  const attachUpdateMany = jest.fn(() => {
    order.push('write:attachFile');
    return Promise.resolve({ count: options.attachedCount ?? 1 });
  });
  const fileFindMany = jest.fn(() => {
    order.push('read:files');
    return Promise.resolve([]);
  });

  const transaction = {
    $queryRaw: queryRaw,
    milestoneDocumentSubmissionHistory: {
      findFirst: historyFindFirst,
      create: historyCreate,
    },
    milestoneDocumentReviewHistory: { findFirst: reviewFindFirst },
    milestoneDocumentSubmission: { findUnique: submissionFindUnique, upsert },
    submissionFile: { updateMany: attachUpdateMany, findMany: fileFindMany },
  };

  const prisma = {
    $transaction: jest.fn((callback: (client: unknown) => Promise<unknown>) =>
      callback(transaction),
    ),
  } as unknown as PrismaService;

  return {
    prisma,
    order,
    transaction,
    upsert,
    historyCreate,
    attachUpdateMany,
    queryRaw,
  };
}

function textInput(
  overrides: Partial<UpsertMilestoneDocumentSubmissionInput> = {},
): UpsertMilestoneDocumentSubmissionInput {
  return {
    milestoneDocumentId: DOCUMENT_ID,
    applicationId: APPLICATION_ID,
    submittedById: CURRENT_MEMBER_ID,
    submittedAt: NOW,
    expectedLatestReviewId: null,
    content: { type: 'TEXT', text: '본문' },
    attachFile: null,
    ...overrides,
  };
}

function fileInput(
  overrides: Partial<UpsertMilestoneDocumentSubmissionInput> = {},
): UpsertMilestoneDocumentSubmissionInput {
  return textInput({
    content: Prisma.JsonNull,
    attachFile: {
      fileId: FILE_ID,
      uploaderId: CURRENT_MEMBER_ID,
      milestoneId: MILESTONE_ID,
    },
    ...overrides,
  });
}

beforeEach(() => {
  lockMembership.mockReset();
});

/**
 * #1269 — `POST /milestones/:id/documents/:id/submissions`도 제출 API와 같은 울타리를 지난다.
 * 트랜잭션 밖에서 읽은 신청 소속은 권한의 정본이 아니므로, 쓰기 트랜잭션 안에서 현재 소속을
 * 다시 잠그고 되읽지 않으면 이미 팀에서 나간 사람의 제출·이력·첨부가 그대로 남는다.
 */
describe('upsertMilestoneDocumentSubmission — 현재 팀원 울타리 (#1269)', () => {
  it('지금 팀원이 아니면 제출·이력·첨부 어느 것도 쓰지 않고 거부한다', async () => {
    // Given: 인가와 쓰기 사이에 제외가 커밋됐다.
    const harness = buildHarness({ member: false });

    // When
    const rejection: unknown = await upsertMilestoneDocumentSubmission(
      harness.prisma,
      fileInput({ submittedById: DEPARTED_MEMBER_ID }),
    ).catch((caught: unknown) => caught);

    // Then: 타입 있는 오류로 나가고, 그 안에 지금 신청·행위자가 그대로 담긴다.
    expect(rejection).toBeInstanceOf(SubmissionMembershipChangedError);
    expect(rejection).toMatchObject({
      applicationId: APPLICATION_ID,
      userId: DEPARTED_MEMBER_ID,
    });
    expect(harness.upsert).not.toHaveBeenCalled();
    expect(harness.historyCreate).not.toHaveBeenCalled();
    expect(harness.attachUpdateMany).not.toHaveBeenCalled();
    // 서류 행 잠금·마감 읽기에도 닿기 전에 끝난다.
    expect(harness.queryRaw).not.toHaveBeenCalled();
  });

  it('파일 없는 제출도 같은 울타리를 지난다 — TEXT 경로가 우회로가 되지 않는다', async () => {
    // Given
    const harness = buildHarness({ member: false });

    // When / Then
    await expect(
      upsertMilestoneDocumentSubmission(
        harness.prisma,
        textInput({ submittedById: DEPARTED_MEMBER_ID }),
      ),
    ).rejects.toBeInstanceOf(SubmissionMembershipChangedError);
    expect(harness.upsert).not.toHaveBeenCalled();
    expect(harness.historyCreate).not.toHaveBeenCalled();
  });

  it('팀장이 아니어도 지금 팀원이면 제출과 이력이 그대로 쓰인다', async () => {
    // Given: 팀장 자리는 권한이 아니다 — 판정은 현재 소속 하나뿐이다.
    const harness = buildHarness();

    // When
    const detail = await upsertMilestoneDocumentSubmission(
      harness.prisma,
      textInput(),
    );

    // Then
    expect(detail).toMatchObject({
      id: SUBMISSION_ID,
      status: SubmissionStatus.SUBMITTED,
      files: [],
    });
    expect(harness.upsert).toHaveBeenCalledTimes(1);
    expect(harness.historyCreate).toHaveBeenCalledWith(
      expect.objectContaining<{ data: unknown }>({
        data: expect.objectContaining({
          actorId: CURRENT_MEMBER_ID,
          event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
          revision: 1,
        }),
      }),
    );
  });

  it('울타리는 트랜잭션 클라이언트로, 서류·판정 잠금보다 **먼저** 불린다', async () => {
    // Given
    const harness = buildHarness();

    // When
    await upsertMilestoneDocumentSubmission(
      harness.prisma,
      fileInput({
        submittedAt: AFTER_DEADLINE,
        deadline: {
          milestoneId: MILESTONE_ID,
          allowAfterDeadline: true,
          expectedSubmissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        },
      }),
    );

    // Then: Program → Team 관문이 Milestone·MilestoneDocument 잠금 앞에 온다.
    expect(lockMembership).toHaveBeenCalledWith(
      harness.transaction,
      APPLICATION_ID,
      CURRENT_MEMBER_ID,
    );
    expect(harness.order[0]).toBe('fence:membership');
    expect(harness.order).toEqual([
      'fence:membership',
      'lock:Milestone',
      'lock:MilestoneDocument',
      'read:latestHistory',
      'read:latestReview',
      'read:currentSubmission',
      'write:submission',
      'write:history',
      'write:attachFile',
      'read:files',
    ]);
  });

  it('재제출은 예전 제출자가 아니라 **지금 내는 사람**으로 판정한다', async () => {
    // Given: revision 2 — 첫 제출은 다른 팀원이 냈다.
    const harness = buildHarness({ revision: 2 });

    // When
    await upsertMilestoneDocumentSubmission(
      harness.prisma,
      textInput({ submittedById: CURRENT_MEMBER_ID }),
    );

    // Then: 울타리도 이력 행위자도 이번 요청의 인증된 학생이다.
    expect(lockMembership).toHaveBeenCalledWith(
      harness.transaction,
      APPLICATION_ID,
      CURRENT_MEMBER_ID,
    );
    expect(lockMembership).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      DEPARTED_MEMBER_ID,
    );
    expect(harness.historyCreate).toHaveBeenCalledWith(
      expect.objectContaining<{ data: unknown }>({
        data: expect.objectContaining({
          actorId: CURRENT_MEMBER_ID,
          event: MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
          revision: 2,
        }),
      }),
    );
  });
});
