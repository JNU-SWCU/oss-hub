import { RepositoryDeletionRepository } from '../platform/repository-deletion.repository';
import { StudentRepositoryUrlContextRepository } from './team.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import { randomBytes } from 'node:crypto';
import {
  ApplicationStatus,
  ProgramCategory,
  RepositorySource,
} from '@prisma/client';
import { DepartmentType, MemberKind } from '../users/user-contract.config';
import { PrismaService } from '../platform/prisma.service';
import { seedDailyContributions } from '../../test/ledger-contribution.fixture';
import { seedRepo } from '../../test/repo-ledger.fixture';
import { ApplicationsRepository } from './team.repository';
import { StudentRepositoryUrlRepository } from './team.repository';
import { StudentRepositoryUrlService } from './team-application.service';

const prisma = new PrismaService();
const namespace = randomBytes(4).toString('hex');
const prefix = `synthetic-url-relink-${namespace}`;
const githubIdBase = BigInt(`0x${namespace}`) * 1000n;
let programId = '';
const userId = `${prefix}-user`;
const githubId = githubIdBase + 1n;
let teamId = '';
let caseNumber = 0;
let targetGithubId = 0n;
let oldGithubId = 0n;
const repository = new StudentRepositoryUrlRepository(
  prisma,
  new PlatformRepository(),
  new StudentRepositoryUrlContextRepository(new PlatformRepository()),
  new RepositoryProvisionGenerationRepository(),
  new RepositoryDeletionRepository(),
);
const applications = new ApplicationsRepository(
  prisma,
  new TeamHistoryRepository(),
  new RepositoryProvisionGenerationRepository(),
  new PlatformRepository(),
);
const resolver = {
  resolve: jest.fn().mockResolvedValue({
    kind: 'EXTERNAL',
    repository: {
      githubRepositoryId: githubIdBase + 3n,
      name: 'target',
      nameWithOwner: 'synthetic/target',
      url: 'https://github.com/synthetic/target',
      visibility: 'PUBLIC',
      description: null,
      defaultBranch: 'main',
      archived: false,
    },
  }),
};

const collectionTrigger = { collectRepository: jest.fn<void, [bigint]>() };
const service = new StudentRepositoryUrlService(
  repository,
  applications,
  resolver,
  { requireCurrent: jest.fn().mockResolvedValue(undefined) },
  collectionTrigger,
  new RepositoryProvisionEventService(),
);
const input = {
  repositoryUrl: 'https://github.com/synthetic/target',
};

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.create({
    data: {
      id: userId,
      githubId,
      nickname: 'synthetic-relink-user',
      name: 'Synthetic user',
      studentId: (githubIdBase / 1000n).toString().padStart(10, '0'),
      department: 'Synthetic',
      type: MemberKind.STUDENT,
      departmentType: DepartmentType.DEPARTMENT,
      profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      approvalStatus: 'NOT_REQUIRED',
    },
  });
});
beforeEach(async () => {
  collectionTrigger.collectRepository.mockClear();
  caseNumber += 1;
  programId = `${prefix}-${caseNumber}-program`;
  teamId = `${prefix}-${caseNumber}-application`;
  teamId = `${prefix}-${caseNumber}-team`;
  targetGithubId = githubIdBase + BigInt(caseNumber * 10);
  oldGithubId = targetGithubId + 1n;
  resolver.resolve.mockResolvedValue({
    kind: 'EXTERNAL',
    repository: {
      githubRepositoryId: targetGithubId,
      name: 'target',
      nameWithOwner: 'synthetic/target',
      url: input.repositoryUrl,
      visibility: 'PUBLIC',
      description: null,
      defaultBranch: 'main',
      archived: false,
    },
  });
  await prisma.program.create({
    data: {
      startAt: new Date('2026-01-01'),
      id: programId,
      name: 'Synthetic relink program',
      organizer: 'Synthetic',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01'),
      applicationEndAt: new Date('2026-01-31'),
      endAt: new Date('2099-01-01'),
      description: 'Synthetic',
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: 'Synthetic team',
      leaderId: userId,
      applicantId: userId,
      answers: { title: 'Synthetic team' },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({ data: { teamId, programId, userId } });
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId,
      applicantId: userId,
      status: ApplicationStatus.APPROVED,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await seedRepo(prisma, {
    githubRepositoryId: oldGithubId,
    nameWithOwner: 'synthetic/old',
    teamId,
    source: RepositorySource.ORG_PROVISIONED,
  });
  await seedRepo(prisma, {
    githubRepositoryId: targetGithubId,
    nameWithOwner: 'synthetic/target',
    source: RepositorySource.EXTERNAL_PUBLIC,
    presence: 'ABSENT',
    goneAt: new Date('2026-01-01T00:00:00.000Z'),
    archived: true,
  });
  await seedDailyContributions(prisma, oldGithubId, [
    { githubId, date: '2026-08-01', commitCount: 7 },
  ]);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await prisma.repositoryProvisionJob.deleteMany({ where: { teamId } });
});
afterAll(async () => {
  await prisma.$disconnect();
});

export {
  prisma,
  service,
  applications,
  resolver,
  collectionTrigger,
  githubId,
  programId,
  teamId,
  targetGithubId,
  oldGithubId,
  input,
};
