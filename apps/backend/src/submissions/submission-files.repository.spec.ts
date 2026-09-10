import { AccountStatus, Prisma, SubmissionFileLifecycle } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { SubmissionFilesRepository } from './submission-files.repository';
import {
  lockSubmissionMembership,
  SubmissionMembershipChangedError,
} from './submission-membership.repository';

jest.mock('./submission-membership.repository', () => ({
  ...jest.requireActual<Record<string, unknown>>(
    './submission-membership.repository',
  ),
  lockSubmissionMembership: jest.fn(),
}));

const lockMembership = lockSubmissionMembership as jest.MockedFunction<
  typeof lockSubmissionMembership
>;

describe('SubmissionFilesRepository exhausted cleanup query', () => {
  const findMany = jest.fn();
  const findUnique = jest.fn();
  const prisma = {
    submissionFile: { findMany },
    user: { findUnique },
  } as unknown as PrismaService;
  const repository = new SubmissionFilesRepository(prisma);

  beforeEach(() => {
    findMany.mockReset();
    findUnique.mockReset();
    findMany.mockResolvedValue([]);
  });

  it('selects only operator-safe columns and filters to retry-exhausted DELETE_PENDING rows', async () => {
    // When
    await repository.findExhaustedCleanups();

    // Then
    const calls = findMany.mock.calls as unknown[][];
    const args = calls[0]![0] as {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    };
    expect(args.where).toEqual({
      lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
      deleteAttemptCount: { gte: 6 },
    });
    expect(Object.keys(args.select).sort()).toEqual([
      'createdAt',
      'deleteAttemptCount',
      'id',
      'lastDeleteError',
    ]);
  });

  it('treats only ACTIVE administrators as authorized operators', async () => {
    // Given / When / Then
    findUnique.mockResolvedValueOnce({
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(repository.findActiveAdminByGithubId(1n)).resolves.toBe(true);

    findUnique.mockResolvedValueOnce({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(repository.findActiveAdminByGithubId(2n)).resolves.toBe(false);

    findUnique.mockResolvedValueOnce({
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    await expect(repository.findActiveAdminByGithubId(3n)).resolves.toBe(false);

    findUnique.mockResolvedValueOnce(null);
    await expect(repository.findActiveAdminByGithubId(4n)).resolves.toBe(false);
  });
});

/**
 * #1269 — 다운로드 권한을 실제 행 매칭으로 검증한다.
 *
 * `where`의 모양만 비교하면 "과거 업로더 OR 현재 팀원" 을 되살려도 통과할 수 있다.
 * 그래서 여기서는 Prisma가 해석할 필터를 그대로 평가하는 작은 매처를 쓰고,
 * 모르는 필터 키가 오면 던져서 조용한 권한 확장을 막는다.
 */
const NOW = new Date('2026-07-25T12:00:00.000Z');
const FUTURE = new Date('2027-01-01T00:00:00.000Z');
const PAST = new Date('2026-01-01T00:00:00.000Z');

interface StoredFileRow {
  readonly id: string;
  readonly lifecycle: SubmissionFileLifecycle;
  readonly milestoneDocumentSubmissionHistoryId: string | null;
  readonly expiresAt: Date | null;
  readonly uploaderId: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** 신청이 매달린 팀의 현재 상태. 탈퇴는 members 에서 사라지는 것으로 표현한다. */
  readonly teamLeaderId: string;
  readonly teamMemberIds: readonly string[];
}

type Filter = Record<string, unknown>;

/** `findDownloadableFile` 이 되돌려받는 열들만 담는다. */
interface DownloadableFileRow {
  readonly id: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly expiresAt: Date | null;
}

/**
 * 참여 판정의 정본은 현재 `TeamMember` 행 하나다
 * (`programApplicationParticipantWhere`). `leaderId` 절이나 OR 분기가 다시 나타나면
 * 여기서 던진다 — 조용히 통과시키면 팀을 떠난 옛 팀장이 다시 새는 것을 놓친다.
 */
function matchesTeam(teamWhere: Filter, row: StoredFileRow): boolean {
  const keys = Object.keys(teamWhere);
  if (keys.length !== 1 || keys[0] !== 'members') {
    throw new Error(
      `Expected the canonical current-TeamMember filter, got: ${keys.join(', ')}`,
    );
  }
  const members = teamWhere.members as { some?: Filter };
  const memberKeys = Object.keys(members);
  const some = members.some;
  if (
    memberKeys.length !== 1 ||
    memberKeys[0] !== 'some' ||
    some === undefined
  ) {
    throw new Error('Unsupported membership branch in the team filter.');
  }
  const someKeys = Object.keys(some);
  const userId = some.userId;
  if (
    someKeys.length !== 1 ||
    someKeys[0] !== 'userId' ||
    typeof userId !== 'string'
  ) {
    throw new Error('Unsupported membership branch in the team filter.');
  }
  return row.teamMemberIds.includes(userId);
}

function matchesFile(where: Filter, row: StoredFileRow): boolean {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case 'id':
        return row.id === value;
      case 'lifecycle':
        return row.lifecycle === value;
      case 'milestoneDocumentSubmissionHistoryId':
        if ((value as { not?: unknown }).not !== null) {
          throw new Error('Unsupported attachment filter.');
        }
        return row.milestoneDocumentSubmissionHistoryId !== null;
      case 'expiresAt': {
        const gt = (value as { gt?: Date }).gt;
        if (!(gt instanceof Date))
          throw new Error('Unsupported expiry filter.');
        return row.expiresAt !== null && row.expiresAt.getTime() > gt.getTime();
      }
      // `uploaderId`·`OR` 는 의도적으로 다루지 않는다. 과거 업로더 절이 어떤 형태로든
      // 되살아나면 default 로 떨어져 던진다 — fail closed.
      case 'application': {
        const inner = (value as { is?: Filter }).is;
        const team = inner?.team as Filter | undefined;
        if (team === undefined) {
          throw new Error('Unsupported application filter.');
        }
        return matchesTeam(team, row);
      }
      default:
        throw new Error(`Unsupported submission-file filter key: ${key}`);
    }
  });
}

describe('SubmissionFilesRepository.findDownloadableFile membership fence', () => {
  const FORMER_UPLOADER = 'user-former-uploader';
  const CURRENT_MEMBER = 'user-current-member';
  /** 승계 도중의 잔류 — `Team.leaderId` 에만 남고 `TeamMember` 행은 이미 사라졌다. */
  const DEPARTED_LEADER = 'user-departed-leader';
  /** 팀장이면서 자기 팀의 `TeamMember` 행을 그대로 가진 정상 상태. */
  const MEMBER_LEADER = 'user-member-leader';

  const attachedFile: StoredFileRow = {
    id: 'file-attached',
    lifecycle: SubmissionFileLifecycle.ATTACHED,
    milestoneDocumentSubmissionHistoryId: 'history-1',
    expiresAt: FUTURE,
    // 귀속은 그대로다 — 나간 사람이 올린 파일이라는 사실은 계속 기록으로 남는다.
    uploaderId: FORMER_UPLOADER,
    storageKey: 'submission-files/private-key',
    originalFileName: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    teamLeaderId: DEPARTED_LEADER,
    teamMemberIds: [CURRENT_MEMBER],
  };
  const leaderTeamFile: StoredFileRow = {
    ...attachedFile,
    id: 'file-leader-team',
    storageKey: 'submission-files/leader-team-key',
    uploaderId: MEMBER_LEADER,
    teamLeaderId: MEMBER_LEADER,
    teamMemberIds: [MEMBER_LEADER],
  };
  const pendingFile: StoredFileRow = {
    ...attachedFile,
    id: 'file-pending',
    lifecycle: SubmissionFileLifecycle.PENDING,
    milestoneDocumentSubmissionHistoryId: null,
  };
  const expiredFile: StoredFileRow = {
    ...attachedFile,
    id: 'file-expired',
    expiresAt: PAST,
  };
  const rows = [attachedFile, leaderTeamFile, pendingFile, expiredFile];

  const findUnique = jest.fn();
  const findFirst = jest.fn<
    Promise<DownloadableFileRow | null>,
    [{ where: Filter }]
  >();
  const prisma = {
    user: { findUnique },
    submissionFile: { findFirst },
  } as unknown as PrismaService;
  const repository = new SubmissionFilesRepository(prisma);

  function requester(overrides: {
    readonly id: string;
    readonly hasStaffAccess?: boolean;
    readonly hasAdminAccess?: boolean;
    readonly accountStatus?: AccountStatus;
  }) {
    findUnique.mockResolvedValue({
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
      ...overrides,
    });
  }

  beforeEach(() => {
    findUnique.mockReset();
    findFirst.mockReset();
    findFirst.mockImplementation((args: { where: Filter }) => {
      const row = rows.find((candidate) => matchesFile(args.where, candidate));
      if (row === undefined) return Promise.resolve(null);
      return Promise.resolve({
        id: row.id,
        storageKey: row.storageKey,
        originalFileName: row.originalFileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        expiresAt: row.expiresAt,
      });
    });
  });

  it('denies an active former uploader who is no longer on the team', async () => {
    // Given: 업로더는 계정은 살아 있지만 TeamMember 행이 사라졌다.
    requester({ id: FORMER_UPLOADER });

    // When
    const file = await repository.findDownloadableFile(
      11n,
      'file-attached',
      NOW,
    );

    // Then
    expect(file).toBeNull();
  });

  it('allows a current team member who never uploaded the file', async () => {
    // Given
    requester({ id: CURRENT_MEMBER });

    // When
    const file = await repository.findDownloadableFile(
      12n,
      'file-attached',
      NOW,
    );

    // Then
    expect(file).toEqual({
      id: 'file-attached',
      storageKey: 'submission-files/private-key',
      originalFileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiresAt: FUTURE,
    });
  });

  // #1269 — 팀장 자리(`Team.leaderId`)는 기록이지 권한이 아니다. 승계·탈퇴는
  // `TeamMember` 집합과 `leaderId` 를 함께 옮기므로, 그 사이 상태에서 leaderId 절을
  // 남겨 두면 팀을 떠난 옛 팀장이 비공개 파일을 계속 받는다.
  it('denies a departed leader left only on the team leaderId column', async () => {
    // Given: leaderId 에는 남았지만 TeamMember 행은 이미 사라졌다.
    requester({ id: DEPARTED_LEADER });

    // When / Then
    await expect(
      repository.findDownloadableFile(13n, 'file-attached', NOW),
    ).resolves.toBeNull();
  });

  it('allows a leader who still holds the TeamMember row', async () => {
    // Given: 팀장도 자기 팀의 TeamMember 행을 갖는다 — 멤버십 한 절로 통과한다.
    requester({ id: MEMBER_LEADER });

    // When / Then
    await expect(
      repository.findDownloadableFile(16n, 'file-leader-team', NOW),
    ).resolves.toMatchObject({ id: 'file-leader-team' });
  });

  it('never puts the historical uploader into the non-staff authorization filter', async () => {
    // Given
    requester({ id: CURRENT_MEMBER });

    // When
    await repository.findDownloadableFile(12n, 'file-attached', NOW);

    // Then
    const where = findFirst.mock.calls[0]![0].where;
    expect(where).toEqual({
      id: 'file-attached',
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      milestoneDocumentSubmissionHistoryId: { not: null },
      expiresAt: { gt: NOW },
      application: {
        is: { team: { members: { some: { userId: CURRENT_MEMBER } } } },
      },
    });
    expect(JSON.stringify(where)).not.toContain('uploaderId');
    expect(JSON.stringify(where)).not.toContain('leaderId');
  });

  it.each([
    ['staff', { hasStaffAccess: true }],
    ['admin', { hasAdminAccess: true }],
  ])(
    'keeps the active %s exception without a participant filter',
    async (_label, access) => {
      // Given: 교직원·관리자는 팀 소속과 무관하게 모든 첨부 파일을 받는다.
      requester({ id: 'user-staff', ...access });

      // When
      const file = await repository.findDownloadableFile(
        14n,
        'file-attached',
        NOW,
      );

      // Then
      expect(file).toMatchObject({ id: 'file-attached' });
      const where = findFirst.mock.calls[0]![0].where;
      expect(where).not.toHaveProperty('application');
      expect(where).not.toHaveProperty('OR');
    },
  );

  it.each([
    ['a deactivated current member', CURRENT_MEMBER],
    ['a deactivated staff account', 'user-staff'],
  ])('denies %s before querying files', async (_label, id) => {
    // Given
    requester({
      id,
      hasStaffAccess: id === 'user-staff',
      accountStatus: AccountStatus.DEACTIVATED,
    });

    // When / Then
    await expect(
      repository.findDownloadableFile(15n, 'file-attached', NOW),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['a PENDING file', 'file-pending'],
    ['an expired file', 'file-expired'],
    ['a nonexistent file', 'file-missing'],
  ])(
    'keeps %s indistinguishable from a denied file for a current member',
    async (_label, fileId) => {
      // Given
      requester({ id: CURRENT_MEMBER });

      // When / Then
      await expect(
        repository.findDownloadableFile(12n, fileId, NOW),
      ).resolves.toBeNull();
    },
  );
});

describe('SubmissionFilesRepository.createPending membership lock', () => {
  const input = {
    uploaderId: 'user-current-member',
    applicationId: 'application-opaque',
    milestoneId: 'milestone-opaque',
    storageKey: 'submission-files/opaque',
    originalFileName: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    pendingExpiresAt: new Date('2026-07-26T12:00:00.000Z'),
  };

  const queryRaw = jest.fn<Promise<unknown[]>, [Prisma.Sql]>();
  const aggregate = jest.fn();
  const create = jest.fn();
  const transactionClient = {
    $queryRaw: queryRaw,
    submissionFile: { aggregate, create },
  };
  const prisma = {
    $transaction: jest.fn(
      (run: (tx: typeof transactionClient) => Promise<unknown>) =>
        run(transactionClient),
    ),
  } as unknown as PrismaService;
  const repository = new SubmissionFilesRepository(prisma);

  beforeEach(() => {
    queryRaw.mockReset();
    aggregate.mockReset();
    create.mockReset();
    lockMembership.mockReset();
    lockMembership.mockResolvedValue(true);
    // 첫 raw 질의는 Program endAt, 두 번째는 uploader User 행 잠금이다.
    queryRaw
      .mockResolvedValueOnce([{ endAt: new Date('2027-02-28T09:30:00.000Z') }])
      .mockResolvedValueOnce([{ id: input.uploaderId }]);
    aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { sizeBytes: 0 },
    });
    create.mockResolvedValue({
      id: 'file-opaque',
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      expiresAt: new Date('2028-02-28T09:30:00.000Z'),
    });
  });

  it('takes the shared Program→Team membership lock before any User or quota work', async () => {
    // When
    await repository.createPending(input);

    // Then
    expect(lockMembership).toHaveBeenCalledWith(
      transactionClient,
      input.applicationId,
      input.uploaderId,
    );
    // Program → Team(공유 잠금) → User 순서를 지켜야 수락·승계 경로와 교착하지 않는다.
    const lockOrder = lockMembership.mock.invocationCallOrder[0]!;
    const rawOrders = queryRaw.mock.invocationCallOrder;
    const aggregateOrder = aggregate.mock.invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(rawOrders[0]!);
    expect(rawOrders[0]!).toBeLessThan(rawOrders[1]!);
    expect(rawOrders[1]!).toBeLessThan(aggregateOrder);
    expect(JSON.stringify(queryRaw.mock.calls[0]![0])).toContain('Program');
    expect(JSON.stringify(queryRaw.mock.calls[1]![0])).toContain('User');
  });

  it('rejects with SubmissionMembershipChangedError without creating a pending row', async () => {
    // Given: 예약 transaction 안에서 다시 읽은 TeamMember 행이 사라졌다.
    lockMembership.mockResolvedValue(false);

    // When / Then
    const rejection = await repository
      .createPending(input)
      .catch((caught: unknown) => caught);
    expect(rejection).toBeInstanceOf(SubmissionMembershipChangedError);
    // 오류는 지금 이 예약의 신청·업로더를 그대로 들고 나간다.
    expect(rejection).toMatchObject({
      applicationId: input.applicationId,
      userId: input.uploaderId,
    });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('still reserves the pending row with the retention expiry for a current member', async () => {
    // When
    const created = await repository.createPending(input);

    // Then
    expect(created).toMatchObject({ id: 'file-opaque' });
    const reservedData: unknown = expect.objectContaining({
      lifecycle: SubmissionFileLifecycle.PENDING,
      pendingExpiresAt: input.pendingExpiresAt,
      expiresAt: new Date('2028-02-28T09:30:00.000Z'),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: reservedData }),
    );
  });

  it('keeps the retention-unavailable branch when the locked Program row is missing', async () => {
    // Given
    queryRaw.mockReset();
    queryRaw.mockResolvedValueOnce([]);

    // When / Then
    await expect(repository.createPending(input)).rejects.toMatchObject({
      name: 'SubmissionFileRetentionUnavailableError',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['the retained file count is at the limit', { _all: 100 }, 0],
    [
      'the retained bytes would exceed the limit',
      { _all: 1 },
      500 * 1024 * 1024,
    ],
  ])('keeps the quota branch when %s', async (_label, count, sizeBytes) => {
    // Given
    aggregate.mockResolvedValue({
      _count: count,
      _sum: { sizeBytes },
    });

    // When / Then
    await expect(repository.createPending(input)).rejects.toMatchObject({
      name: 'SubmissionFileQuotaExceededError',
    });
    expect(create).not.toHaveBeenCalled();
  });
});
