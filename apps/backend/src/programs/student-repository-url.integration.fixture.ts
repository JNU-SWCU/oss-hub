import { RepositoryDeletionRepository } from '../platform/repository-deletion.repository';
import { AuditLogReadService } from '../platform/audit-log-read.service';
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
import { AuditLogRepository } from '../platform/audit-log.repository';
import { AuditLogService } from '../platform/audit-log.service';
import { ApplicationsRepository } from './team.repository';
import { StudentRepositoryUrlRepository } from './team.repository';
import { StudentRepositoryUrlService } from './team-application.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';

const prisma = new PrismaService();
const namespace = randomBytes(4).toString('hex');
const prefix = `synthetic-url-relink-${namespace}`;
const githubIdBase = BigInt(`0x${namespace}`) * 1000n;
let programId = '';
const userId = `${prefix}-user`;
const githubId = githubIdBase + 1n;
let teamId = '';
let oldId = '';
let targetId = '';
let caseNumber = 0;
let targetGithubId = 0n;
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
const audit = new AuditLogService(
  new AuditLogRepository(prisma),
  new AuditLogReadService(new AuditLogMetadataService()),
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
  oldId = `${prefix}-${caseNumber}-old`;
  targetId = `${prefix}-${caseNumber}-target`;
  targetGithubId = githubIdBase + BigInt(caseNumber * 10);
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
  await prisma.githubRepository.create({
    data: {
      id: oldId,
      githubRepositoryId: targetGithubId + 1n,
      nameWithOwner: 'synthetic/old',
      teamId,
      source: RepositorySource.ORG_PROVISIONED,
    },
  });
  await prisma.githubRepository.create({
    data: {
      id: targetId,
      githubRepositoryId: targetGithubId,
      nameWithOwner: 'synthetic/target',
      source: RepositorySource.EXTERNAL_PUBLIC,
      presence: 'ABSENT',
      failureCount: 4,
      archived: true,
      nextRunAt: new Date('2099-01-01'),
    },
  });
  await prisma.contribution.create({
    data: {
      repositoryId: oldId,
      githubId,
      date: new Date('2026-08-01'),
      commitCount: 7,
    },
  });
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
  audit,
  resolver,
  collectionTrigger,
  githubId,
  programId,
  teamId,
  oldId,
  targetId,
  targetGithubId,
  input,
};
