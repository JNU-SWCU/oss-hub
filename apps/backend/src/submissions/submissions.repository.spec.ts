import {
  MilestoneSubmissionType,
  type Prisma,
  SubmissionStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { CreateSubmissionInput } from './domain/submission-content';
import { submissionParticipantWhere } from './submission-application.record';
import {
  lockSubmissionMembership,
  SubmissionMembershipChangedError,
} from './submission-membership.repository';
import {
  type CreateSubmissionRevisionInput,
  StaleSubmissionRevisionError,
  SubmissionsRepository,
} from './submissions.repository';

// 잠금 자체(Program→Team FOR UPDATE 순서와 잠금 뒤 재조회)는 helper 소유 스펙이 고정한다.
// 이 스펙은 **쓰기 경계가 그 helper를 실제로 통과하는지**와, 거절되면 아무것도 남지 않는지를 본다.
jest.mock('./submission-membership.repository', () => {
  const actual = jest.requireActual<
    typeof import('./submission-membership.repository')
  >('./submission-membership.repository');
  return { ...actual, lockSubmissionMembership: jest.fn() };
});

const lockMembership = jest.mocked(lockSubmissionMembership);

const NOW = new Date('2026-07-31T00:00:00.000Z');
const APPLICATION_ID = 'application-1';
/** 지금 그 팀에 속해 있고 지금 쓰기를 시도하는 사람 — 판정 기준은 이 사람뿐이다. */
const CURRENT_MEMBER_ID = 'current-member';

/**
 * 호출 인자를 형을 잃지 않고 기록하는 delegate 대역.
 * `jest.fn()`의 `mock.calls`는 `any`라서 인자 검증이 조용히 형 밖으로 빠진다.
 */
function recorder<TArgs, TResult>(
  log: string[],
  label: string,
  result: TResult,
) {
  const calls: TArgs[] = [];
  return {
    calls,
    /**
     * 기록된 **유일한** 호출 인자. 없거나 둘 이상이면 그 자리에서 실패한다 —
     * 인자 검증이 조용한 undefined 통과로 바뀌지 않게 하는 것이 목적이다.
     */
    onlyCall: (): TArgs => {
      const [args] = calls;
      if (calls.length !== 1 || args === undefined) {
        throw new Error(
          `${label} 호출은 정확하게 1회여야 한다 — 실제 ${calls.length}회`,
        );
      }
      return args;
    },
    fn: (args: TArgs): Promise<TResult> => {
      calls.push(args);
      log.push(label);
      return Promise.resolve(result);
    },
  };
}

function createInput(
  overrides: Partial<CreateSubmissionInput> = {},
): CreateSubmissionInput {
  return {
    applicationId: APPLICATION_ID,
    milestoneId: 'milestone-1',
    content: { type: MilestoneSubmissionType.TEXT, text: '제출 본문' },
    comment: null,
    ...overrides,
  };
}

function revisionInput(
  overrides: Partial<CreateSubmissionRevisionInput> = {},
): CreateSubmissionRevisionInput {
  return {
    submissionId: 'target-submission-1',
    baseRevision: 1,
    baseStatus: SubmissionStatus.CHANGES_REQUESTED,
    content: { type: MilestoneSubmissionType.TEXT, text: '보완한 본문' },
    comment: '실행 화면을 추가했습니다',
    submittedById: CURRENT_MEMBER_ID,
    applicationId: APPLICATION_ID,
    milestoneId: 'milestone-1',
    fileExpiresAt: null,
    now: NOW,
    ...overrides,
  };
}

function buildHarness(
  overrides: {
    readonly stillMember?: boolean;
    readonly casUpdatedCount?: number;
  } = {},
) {
  const calls: string[] = [];
  lockMembership.mockImplementation(() => {
    calls.push('lockMembership');
    return Promise.resolve(overrides.stillMember ?? true);
  });

  const applicationFindFirst = recorder<Prisma.ApplicationFindFirstArgs, null>(
    calls,
    'application.findFirst',
    null,
  );
  const slotFindFirst = recorder<
    Prisma.MilestoneDocumentFindFirstArgs,
    { id: string }
  >(calls, 'milestoneDocument.findFirst', { id: 'legacy-document-1' });
  const submissionCreate = recorder<
    Prisma.MilestoneDocumentSubmissionCreateArgs,
    { id: string; status: SubmissionStatus; submittedAt: Date }
  >(calls, 'submission.create', {
    id: 'submission-1',
    status: SubmissionStatus.SUBMITTED,
    submittedAt: NOW,
  });
  const submissionUpdateMany = recorder<
    Prisma.MilestoneDocumentSubmissionUpdateManyArgs,
    { count: number }
  >(calls, 'submission.updateMany', {
    count: overrides.casUpdatedCount ?? 1,
  });
  const historyCreate = recorder<
    Prisma.MilestoneDocumentSubmissionHistoryCreateArgs,
    { id: string; revision: number }
  >(calls, 'history.create', { id: 'history-1', revision: 2 });
  const fileUpdateMany = recorder<
    Prisma.SubmissionFileUpdateManyArgs,
    { count: number }
  >(calls, 'submissionFile.updateMany', { count: 1 });

  // `withTransaction`은 같은 대역을 트랜잭션 클라이언트로 다시 넘긴다 — 잠금이 그
  // 클라이언트로 가는지를 봐야 하므로 동일 객체를 다시 쓴다.
  function fakeTransaction<T>(
    operation: (client: unknown) => Promise<T>,
  ): Promise<T> {
    return operation(database);
  }

  const database = {
    application: { findFirst: applicationFindFirst.fn },
    milestoneDocument: { findFirst: slotFindFirst.fn },
    milestoneDocumentSubmission: {
      create: submissionCreate.fn,
      updateMany: submissionUpdateMany.fn,
    },
    milestoneDocumentSubmissionHistory: { create: historyCreate.fn },
    submissionFile: { updateMany: fileUpdateMany.fn },
    $transaction: fakeTransaction,
  };

  return {
    repository: new SubmissionsRepository(database as unknown as PrismaService),
    database,
    calls,
    applicationFindFirst,
    submissionCreate,
    submissionUpdateMany,
    historyCreate,
    fileUpdateMany,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('참여자 판정 조건', () => {
  it('신청 조회는 programId 범위를 유지한 채 현재 팀 소속만으로 참여자를 판정한다', async () => {
    // Given
    const { repository, applicationFindFirst } = buildHarness();

    // When
    await repository.findParticipantApplication(
      'program-1',
      'milestone-1',
      CURRENT_MEMBER_ID,
    );

    // Then
    const where = applicationFindFirst.onlyCall().where;
    expect(where).toMatchObject({
      programId: 'program-1',
      ...submissionParticipantWhere(CURRENT_MEMBER_ID),
    });
    // 팀을 떠난 옛 팀장·옛 신청자가 계속 통과하던 갈래가 남아 있으면 안 된다(#1269).
    expect(JSON.stringify(where)).not.toContain('leaderId');
    expect(JSON.stringify(where)).not.toContain('applicantId');
  });
});

describe('createSubmission', () => {
  it('잠금 뒤 팀원이 아니면 제출도 이력도 만들지 않고 멤버십 오류를 던진다', async () => {
    // Given
    const { repository, database, submissionCreate, historyCreate } =
      buildHarness({ stillMember: false });

    // When & Then
    await expect(
      repository.createSubmission(createInput(), CURRENT_MEMBER_ID, NOW, null),
    ).rejects.toBeInstanceOf(SubmissionMembershipChangedError);
    expect(lockMembership).toHaveBeenCalledWith(
      database,
      APPLICATION_ID,
      CURRENT_MEMBER_ID,
    );
    expect(submissionCreate.calls).toHaveLength(0);
    expect(historyCreate.calls).toHaveLength(0);
  });

  it('제출 슬롯을 찾기 전에 멤버십을 먼저 잠근다', async () => {
    // Given
    const { repository, calls } = buildHarness();

    // When
    const created = await repository.createSubmission(
      createInput(),
      CURRENT_MEMBER_ID,
      NOW,
      null,
    );

    // Then
    expect(created).toEqual({
      id: 'submission-1',
      status: SubmissionStatus.SUBMITTED,
      submittedAt: NOW,
    });
    expect(calls).toEqual([
      'lockMembership',
      'milestoneDocument.findFirst',
      'submission.create',
      'history.create',
    ]);
  });

  it('트랜잭션 store의 쓰기도 그 트랜잭션 클라이언트로 잠근다', async () => {
    // Given
    const { repository, database } = buildHarness();

    // When
    await repository.withTransaction((store) =>
      store.createSubmission(createInput(), CURRENT_MEMBER_ID, NOW, null),
    );

    // Then
    expect(lockMembership).toHaveBeenCalledTimes(1);
    expect(lockMembership).toHaveBeenCalledWith(
      database,
      APPLICATION_ID,
      CURRENT_MEMBER_ID,
    );
  });
});

describe('createSubmissionRevision', () => {
  it('잠금 뒤 팀원이 아니면 revision·이력을 쓰지 않고 멤버십 오류를 던진다', async () => {
    // Given
    const { repository, submissionUpdateMany, historyCreate } = buildHarness({
      stillMember: false,
    });

    // When & Then
    await expect(
      repository.createSubmissionRevision(revisionInput()),
    ).rejects.toBeInstanceOf(SubmissionMembershipChangedError);
    expect(submissionUpdateMany.calls).toHaveLength(0);
    expect(historyCreate.calls).toHaveLength(0);
  });

  it('CAS 갱신 전에 지금 쓰는 사람으로 멤버십을 잠근다', async () => {
    // Given
    const { repository, database, calls } = buildHarness();

    // When
    const result = await repository.createSubmissionRevision(revisionInput());

    // Then
    expect(result).toEqual({ revision: 2 });
    expect(calls).toEqual([
      'lockMembership',
      'submission.updateMany',
      'history.create',
    ]);
    expect(lockMembership).toHaveBeenCalledWith(
      database,
      APPLICATION_ID,
      CURRENT_MEMBER_ID,
    );
  });

  it('CAS 조건은 revision·status만 보고 과거 제출자를 권한으로 쓰지 않는다', async () => {
    // Given — 원장에 남은 옛 제출자는 이미 팀을 떠난 사람일 수 있다.
    const { repository, submissionUpdateMany, historyCreate } = buildHarness();

    // When
    await repository.createSubmissionRevision(revisionInput());

    // Then
    expect(submissionUpdateMany.onlyCall().where).toEqual({
      id: 'target-submission-1',
      status: SubmissionStatus.CHANGES_REQUESTED,
      revision: 1,
    });
    // 이력 귀속은 지금 쓰는 사람이다 — 과거 이력을 덮어쓰거나 되살리지 않는다.
    expect(historyCreate.onlyCall().data).toMatchObject({
      milestoneDocumentSubmissionId: 'target-submission-1',
      revision: 2,
      actorId: CURRENT_MEMBER_ID,
    });
  });

  it('밀린 revision은 잠금 뒤에도 STALE로 끊기고 이력을 남기지 않는다', async () => {
    // Given
    const { repository, historyCreate } = buildHarness({ casUpdatedCount: 0 });

    // When & Then
    await expect(
      repository.createSubmissionRevision(revisionInput()),
    ).rejects.toBeInstanceOf(StaleSubmissionRevisionError);
    expect(lockMembership).toHaveBeenCalledTimes(1);
    expect(historyCreate.calls).toHaveLength(0);
  });
});
