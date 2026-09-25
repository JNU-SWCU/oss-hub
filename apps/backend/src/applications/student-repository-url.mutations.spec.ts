import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StudentRepositoryUrlService } from './student-repository-url.service';
import { StudentRepositoryUrlTransaction } from './student-repository-url.transaction.repository';
import type {
  StudentRepositoryUrlContext,
  StudentRepositoryUrlRepository,
  TeamRepositoryUrlContext,
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
const leader = { nickname: 'synthetic-actor', isLeader: true, isStaff: false };
const staff = { nickname: 'synthetic-staff', isLeader: false, isStaff: true };
const member = {
  nickname: 'synthetic-member',
  isLeader: false,
  isStaff: false,
};
const input = {
  repositoryUrl: 'https://github.com/synthetic/target',
};

function fixture(
  editor: TeamRepositoryUrlContext['editor'] = leader,
  studentId = 'leader',
) {
  const teamContext: TeamRepositoryUrlContext = { ...context, editor };
  const transaction = new StudentRepositoryUrlTransaction(new PrismaService());
  const lockTeamContext = jest
    .spyOn(transaction, 'lockTeamContext')
    .mockResolvedValue(teamContext);
  const relink = jest.spyOn(transaction, 'relink').mockResolvedValue('target');
  const repository = {
    findContext: jest.fn().mockResolvedValue(context),
    findTeamContext: jest.fn().mockResolvedValue(teamContext),
    withTransaction: <T>(
      operation: (store: StudentRepositoryUrlTransaction) => Promise<T>,
    ) => operation(transaction),
  } satisfies Pick<
    StudentRepositoryUrlRepository,
    'findContext' | 'findTeamContext' | 'withTransaction'
  >;
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
  return {
    service,
    repository,
    resolver,
    consents,
    audit,
    lockTeamContext,
    relink,
  };
}

afterEach(() => jest.restoreAllMocks());
it('lets a participant read the URL with editing disabled', async () => {
  const { service } = fixture(member, 'member');
  expect(await service.getMine(4n, 'program')).toEqual({
    repositoryUrl: 'https://github.com/synthetic/old',
    canEditRepositoryUrl: false,
  });
});
it('rejects a nonmanager before contacting GitHub', async () => {
  const { service, resolver } = fixture(member, 'member');
  await expect(service.updateMine(4n, 'program', input)).rejects.toMatchObject({
    errorCode: { code: 'APP_001' },
  });
  expect(resolver.resolve).not.toHaveBeenCalled();
});
it('resolves the student team before taking the shared team path', async () => {
  const { service, repository } = fixture();
  await service.updateMine(1n, 'program', input);
  expect(repository.findTeamContext).toHaveBeenCalledWith(
    'program',
    'team',
    1n,
  );
});
it('answers a student without a team application with 404 before GitHub', async () => {
  const { service, repository, resolver } = fixture();
  repository.findContext.mockResolvedValue(null);
  await expect(service.updateMine(1n, 'program', input)).rejects.toMatchObject({
    errorCode: { code: 'APP_001' },
  });
  expect(resolver.resolve).not.toHaveBeenCalled();
});
it('requires the applicant consent for an external repository even when the leader edits', async () => {
  const { service, consents, relink } = fixture();
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
  const { service, lockTeamContext, relink } = fixture();
  lockTeamContext.mockResolvedValue({
    ...context,
    editor: leader,
    program: { ...context.program, endAt: new Date('2020-01-01') },
  });
  await expect(service.updateMine(1n, 'program', input)).rejects.toMatchObject({
    errorCode: { code: 'APP_028' },
  });
  expect(relink).not.toHaveBeenCalled();
});
it('records old and new identities with the actor snapshot in the transaction', async () => {
  const { service, audit, relink } = fixture();
  const result = await service.updateMine(1n, 'program', input);
  expect(result.repositoryUrl).toBe(input.repositoryUrl);
  expect(relink).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'application' }),
    expect.objectContaining({ kind: 'EXTERNAL' }),
  );
  const calls: readonly (readonly unknown[])[] = audit.record.mock.calls;
  const record = calls[0]?.[0];
  expect(record).toMatchObject({
    action: 'APPLICATION_REPOSITORY_URL_CHANGED',
    metadata: {
      actorGithubLogin: 'synthetic-actor',
      schemaVersion: 2,
      before: { repositoryId: 'old' },
      after: { repositoryId: 'target' },
    },
  });
});
it('passes a managed organization private replacement through the transaction without applicant consent', async () => {
  const { service, consents, relink, resolver } = fixture();
  resolver.resolve.mockResolvedValue({
    kind: 'ORGANIZATION',
    repository: {
      githubRepositoryId: 3n,
      nameWithOwner: 'synthetic-org/target',
      visibility: 'PRIVATE',
    },
  });
  await service.updateMine(1n, 'program', {
    ...input,
    repositoryUrl: 'https://github.com/synthetic-org/target',
  });
  expect(consents.requireCurrent).not.toHaveBeenCalled();
  expect(relink).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'application' }),
    expect.objectContaining({ kind: 'ORGANIZATION' }),
  );
});

it('denies the original applicant after leadership has changed', async () => {
  const { service, resolver, relink } = fixture(member, 'student');
  expect(await service.getMine(1n, 'program')).toMatchObject({
    canEditRepositoryUrl: false,
  });
  await expect(service.updateMine(1n, 'program', input)).rejects.toMatchObject({
    errorCode: { code: 'APP_001' },
  });
  expect(resolver.resolve).not.toHaveBeenCalled();
  expect(relink).not.toHaveBeenCalled();
});

it('rechecks leadership after locking before relinking', async () => {
  const { service, lockTeamContext, relink, audit } = fixture();
  lockTeamContext.mockResolvedValue({ ...context, editor: member });
  await expect(service.updateMine(1n, 'program', input)).rejects.toMatchObject({
    errorCode: { code: 'APP_001' },
  });
  expect(relink).not.toHaveBeenCalled();
  expect(audit.record).not.toHaveBeenCalled();
});

it('lets staff outside the team save with the same audit action and the applicant consent', async () => {
  const { service, repository, consents, relink, audit } = fixture(staff);
  await expect(
    service.updateForTeam(9n, 'program', 'team', input),
  ).resolves.toEqual({
    repositoryUrl: input.repositoryUrl,
    canEditRepositoryUrl: true,
  });
  expect(repository.findTeamContext).toHaveBeenCalledWith(
    'program',
    'team',
    9n,
  );
  expect(consents.requireCurrent).toHaveBeenCalledWith(1n);
  expect(relink).toHaveBeenCalledTimes(1);
  const calls: readonly (readonly unknown[])[] = audit.record.mock.calls;
  expect(calls[0]?.[0]).toMatchObject({
    actorGithubId: 9n,
    action: 'APPLICATION_REPOSITORY_URL_CHANGED',
    metadata: { actorGithubLogin: 'synthetic-staff', teamId: 'team' },
  });
});
it.each([
  ['a rejected application', { status: ApplicationStatus.REJECTED }],
  [
    'an ended program',
    { program: { ...context.program, endAt: new Date('2020-01-01') } },
  ],
])('closes staff edits on %s before GitHub', async (_label, override) => {
  const { service, repository, resolver } = fixture(staff);
  repository.findTeamContext.mockResolvedValue({
    ...context,
    ...override,
    editor: staff,
  });
  await expect(
    service.updateForTeam(9n, 'program', 'team', input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_028' } });
  expect(resolver.resolve).not.toHaveBeenCalled();
});
it('answers an unknown team or inactive actor with 404 before GitHub', async () => {
  const { service, repository, resolver } = fixture(staff);
  repository.findTeamContext.mockResolvedValue(null);
  await expect(
    service.updateForTeam(9n, 'program', 'team', input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_001' } });
  expect(resolver.resolve).not.toHaveBeenCalled();
});
it('rechecks staff access after locking before relinking', async () => {
  const { service, lockTeamContext, relink, audit } = fixture(staff);
  lockTeamContext.mockResolvedValue({ ...context, editor: member });
  await expect(
    service.updateForTeam(9n, 'program', 'team', input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_001' } });
  expect(relink).not.toHaveBeenCalled();
  expect(audit.record).not.toHaveBeenCalled();
});
