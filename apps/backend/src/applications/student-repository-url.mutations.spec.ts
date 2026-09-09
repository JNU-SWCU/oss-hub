import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StudentRepositoryUrlService } from './student-repository-url.service';
import { StudentRepositoryUrlTransaction } from './student-repository-url.transaction.repository';
import type {
  StudentRepositoryUrlContext,
  StudentRepositoryUrlRepository,
} from './student-repository-url.repository';

const context: StudentRepositoryUrlContext = {
  id: 'application',
  programId: 'program',
  teamId: 'team',
  status: ApplicationStatus.APPROVED,
  applicantId: 'student',
  applicant: { githubId: 1n },
  team: { leaderId: 'leader' },
  program: { name: 'Synthetic program', endAt: new Date('2099-01-01') },
  repository: {
    id: 'old',
    githubRepositoryId: 2n,
    nameWithOwner: 'synthetic/old',
  },
};
const input = {
  repositoryUrl: 'https://github.com/synthetic/target',
  reason: 'Moved',
};

function fixture(studentId = 'student') {
  const transaction = new StudentRepositoryUrlTransaction(new PrismaService());
  const lockContext = jest
    .spyOn(transaction, 'lockContext')
    .mockResolvedValue(context);
  const relink = jest.spyOn(transaction, 'relink').mockResolvedValue('target');
  const repository: Pick<
    StudentRepositoryUrlRepository,
    'findContext' | 'withTransaction'
  > = {
    findContext: jest.fn().mockResolvedValue(context),
    withTransaction: (operation) => operation(transaction),
  };
  const resolver = {
    resolve: jest.fn().mockResolvedValue({
      kind: 'EXTERNAL',
      repository: {
        githubRepositoryId: 3n,
        nameWithOwner: 'synthetic/target',
        visibility: 'PUBLIC',
        defaultBranch: 'main',
        archived: false,
      },
    }),
  };
  const consents = { requireCurrent: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new StudentRepositoryUrlService(
    repository,
    {
      findActiveStudentByGithubId: jest.fn().mockResolvedValue({
        id: studentId,
        nickname: 'synthetic-actor',
        name: null,
      }),
    },
    resolver,
    consents,
    audit,
  );
  return { service, resolver, consents, audit, lockContext, relink };
}

afterEach(() => jest.restoreAllMocks());
it('lets a participant read the URL with editing disabled', async () => {
  const { service } = fixture('member');
  expect(await service.getMine(4n, 'program')).toEqual({
    repositoryUrl: 'https://github.com/synthetic/old',
    canEditRepositoryUrl: false,
  });
});
it('rejects a nonmanager before contacting GitHub', async () => {
  const { service, resolver } = fixture('member');
  await expect(service.updateMine(4n, 'program', input)).rejects.toMatchObject({
    errorCode: { code: 'APP_001' },
  });
  expect(resolver.resolve).not.toHaveBeenCalled();
});
it('requires the applicant consent for an external repository even when the leader edits', async () => {
  const { service, consents, relink } = fixture('leader');
  consents.requireCurrent.mockRejectedValue(new Error('Consent absent'));
  await expect(service.updateMine(4n, 'program', input)).rejects.toThrow(
    'Consent absent',
  );
  expect(consents.requireCurrent).toHaveBeenCalledWith(1n);
  expect(relink).not.toHaveBeenCalled();
});
it('does not mutate or audit when the current canonical repository is submitted again', async () => {
  const { service, resolver, audit, relink } = fixture();
  resolver.resolve.mockResolvedValue({
    kind: 'ORGANIZATION',
    repository: { githubRepositoryId: 2n, nameWithOwner: 'synthetic/old' },
  });
  await service.updateMine(1n, 'program', {
    ...input,
    repositoryUrl: 'https://github.com/synthetic/old/',
  });
  expect(relink).not.toHaveBeenCalled();
  expect(audit.record).not.toHaveBeenCalled();
});
it('rechecks the program end after the context is locked', async () => {
  const { service, lockContext, relink } = fixture();
  lockContext.mockResolvedValue({
    ...context,
    program: { ...context.program, endAt: new Date('2020-01-01') },
  });
  await expect(service.updateMine(1n, 'program', input)).rejects.toMatchObject({
    errorCode: { code: 'APP_028' },
  });
  expect(relink).not.toHaveBeenCalled();
});
it('records old and new identities with the actor snapshot in the transaction', async () => {
  const { service, audit } = fixture();
  const result = await service.updateMine(1n, 'program', input);
  expect(result.repositoryUrl).toBe(input.repositoryUrl);
  const calls: readonly (readonly unknown[])[] = audit.record.mock.calls;
  const record = calls[0]?.[0];
  expect(record).toMatchObject({
    action: 'APPLICATION_REPOSITORY_URL_CHANGED',
    metadata: {
      actorGithubLogin: 'synthetic-actor',
      reason: 'Moved',
      before: { repositoryId: 'old' },
      after: { repositoryId: 'target' },
    },
  });
});
