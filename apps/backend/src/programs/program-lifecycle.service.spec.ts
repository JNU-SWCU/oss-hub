import { Prisma, ProgramLifecycle } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramHistoryRepository,
  ProgramDeletionScopeRepository,
  type ProgramDeletionScopeCounts,
  ProgramLifecycleRepository,
  type ProgramPurgeDeletedCounts,
} from './programs.repository';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { ProgramLifecycleService } from './programs.service';
import { ProgramErrorCode } from './programs.error';

const scope: ProgramDeletionScopeCounts = {
  applications: 2,
  teams: 2,
  boardPosts: 1,
  submissions: 1,
  submissionEvents: 3,
  scopeFingerprint: 'fixture-fingerprint',
};
const queuedFiles: ProgramPurgeDeletedCounts = {
  applications: 0,
  teams: 0,
  teamMembers: 0,
  teamInvitations: 0,
  boardPosts: 0,
  boardComments: 0,
  submissions: 0,
  submissionRevisions: 0,
  reviews: 0,
  milestones: 0,
  milestoneDocuments: 0,
  milestoneDocumentSubmissions: 0,
  milestoneDocumentSubmissionHistories: 0,
  programCreateRequests: 0,
  repositoryProvisionJobs: 0,
  githubRepositoriesDetached: 0,
  outboxEvents: 0,
  notifications: 0,
  files: 4,
};

function setup(
  options: {
    readonly missing?: boolean;
    readonly lifecycle?: ProgramLifecycle;
    readonly currentScope?: ProgramDeletionScopeCounts;
    readonly transactionError?: Error;
  } = {},
) {
  const prisma = new PrismaService();
  const metadata = new HistoryMetadataService();
  const currentScope = options.currentScope ?? scope;
  const repository = new ProgramLifecycleRepository(
    prisma,
    new ProgramDeletionScopeRepository(),
  );
  const program = options.missing
    ? null
    : {
        id: 'program-1',
        name: 'Synthetic program',
        lifecycle: options.lifecycle ?? ProgramLifecycle.PUBLISHED,
      };
  const queue = jest
    .spyOn(repository, 'purgeProgramTree')
    .mockResolvedValue(queuedFiles);
  const markDeleted = jest
    .spyOn(repository, 'deleteProgram')
    .mockResolvedValue();
  jest.spyOn(repository, 'findProgramForDeletion').mockResolvedValue(program);
  jest
    .spyOn(repository, 'readScopeCountsInTransaction')
    .mockResolvedValue(currentScope);
  jest.spyOn(repository, 'readScopeCounts').mockResolvedValue(currentScope);
  Object.assign(repository, {
    withPurgeTransaction: async <T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> => {
      if (options.transactionError) throw options.transactionError;
      return operation(prisma);
    },
  });
  const programHistory = new ProgramHistoryRepository();
  const record = jest.spyOn(programHistory, 'append').mockResolvedValue();
  const service = new ProgramLifecycleService(
    repository,
    programHistory,
    metadata,
    new PrismaSerializationRetryRepository(),
  );
  return { service, queue, markDeleted, record };
}

describe('ProgramLifecycleService status deletion', () => {
  it.each(['delete', 'purge'] as const)(
    '%s records the actor and changes status even with descendants',
    async (operation) => {
      const { service, record, markDeleted } = setup();
      const result =
        operation === 'delete'
          ? await service.delete(1001n, 'program-1')
          : await service.purge(1001n, 'program-1', scope);
      expect(result).toMatchObject({ id: 'program-1', deleted: true });
      expect(markDeleted).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]?.[1]).toMatchObject({
        actorGithubId: 1001n,
        event: 'DELETED',
        programId: 'program-1',
        metadata: {
          programName: 'Synthetic program',
          lifecycle: ProgramLifecycle.PUBLISHED,
        },
      });
    },
  );

  it('keeps the original archived state in the deletion history', async () => {
    const { service, record } = setup({ lifecycle: ProgramLifecycle.ARCHIVED });
    await service.purge(1001n, 'program-1', scope);
    expect(record.mock.calls[0]?.[1]).toMatchObject({
      metadata: { lifecycle: ProgramLifecycle.ARCHIVED },
    });
  });

  it.each(['delete', 'purge'] as const)(
    '%s rejects missing or previously deleted programs before queueing bytes',
    async (operation) => {
      const { service, queue, markDeleted, record } = setup({ missing: true });
      await expect(
        operation === 'delete'
          ? service.delete(1001n, 'missing')
          : service.purge(1001n, 'missing', scope),
      ).rejects.toMatchObject({
        errorCode: { code: ProgramErrorCode.PROGRAM_NOT_FOUND },
      });
      expect(queue).not.toHaveBeenCalled();
      expect(markDeleted).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...scope, applications: 3 },
    { ...scope, teams: 3 },
    { ...scope, boardPosts: 2 },
    { ...scope, submissions: 2 },
    { ...scope, submissionEvents: 4 },
    { ...scope, scopeFingerprint: 'same-count-different-identities' },
  ])(
    'rejects a changed confirmed scope before any write: %j',
    async (currentScope) => {
      const { service, queue, markDeleted, record } = setup({ currentScope });
      await expect(
        service.purge(1001n, 'program-1', scope),
      ).rejects.toMatchObject({
        errorCode: { code: ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED },
        extensions: { currentScopeCounts: currentScope },
      });
      expect(queue).not.toHaveBeenCalled();
      expect(markDeleted).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );

  it.each([scope, { ...scope, boardPosts: 2 }])(
    'maps serialization failures to a fresh scope conflict',
    async (currentScope) => {
      const transactionError = new Prisma.PrismaClientKnownRequestError(
        'serialization',
        { code: 'P2034', clientVersion: 'test' },
      );
      const { service } = setup({ transactionError, currentScope });
      await expect(
        service.purge(1001n, 'program-1', scope),
      ).rejects.toMatchObject({
        errorCode: { code: ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED },
        extensions: { currentScopeCounts: currentScope },
      });
    },
  );

  it('maps a foreign key race with changed scope to a conflict', async () => {
    const currentScope = { ...scope, boardPosts: 2 };
    const transactionError = new Prisma.PrismaClientKnownRequestError(
      'foreign key',
      { code: 'P2003', clientVersion: 'test' },
    );
    const { service } = setup({ transactionError, currentScope });
    await expect(
      service.purge(1001n, 'program-1', scope),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED },
      extensions: { currentScopeCounts: currentScope },
    });
  });

  it.each([
    new Prisma.PrismaClientKnownRequestError('foreign key', {
      code: 'P2003',
      clientVersion: 'test',
    }),
    new Error('unrelated database failure'),
  ])(
    'propagates an unrelated transaction failure without reporting success',
    async (transactionError) => {
      const { service, record } = setup({ transactionError });
      await expect(service.purge(1001n, 'program-1', scope)).rejects.toBe(
        transactionError,
      );
      expect(record).not.toHaveBeenCalled();
    },
  );
});
