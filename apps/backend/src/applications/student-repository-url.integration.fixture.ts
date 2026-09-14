import { randomBytes } from 'node:crypto';
import {
  AffiliationKind,
  ApplicationStatus,
  MemberKind,
  ProgramCategory,
  RepositorySource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ApplicationsRepository } from './applications.repository';
import { StudentRepositoryUrlRepository } from './student-repository-url.repository';
import { StudentRepositoryUrlService } from './student-repository-url.service';

const prisma = new PrismaService();
const namespace = randomBytes(4).toString('hex');
const prefix = `synthetic-url-relink-${namespace}`;
const githubIdBase = BigInt(`0x${namespace}`) * 1000n;
let programId = '';
const userId = `${prefix}-user`;
const githubId = githubIdBase + 1n;
let applicationId = '';
let teamId = '';
let oldId = '';
let targetId = '';
let caseNumber = 0;
let targetGithubId = 0n;
const repository = new StudentRepositoryUrlRepository(prisma);
const applications = new ApplicationsRepository(prisma, {
  TEAM_JOIN_CODE_SECRET: 'synthetic-relink-secret',
});
const audit = new AuditLogService(new AuditLogRepository(prisma));
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
const service = new StudentRepositoryUrlService(
  repository,
  applications,
  resolver,
  { requireCurrent: jest.fn().mockResolvedValue(undefined) },
  audit,
);
const input = {
  repositoryUrl: 'https://github.com/synthetic/target',
  reason: 'Project moved',
};

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.create({
    data: {
      id: userId,
      githubId,
      nickname: 'synthetic-relink-user',
      selectedMemberKind: MemberKind.STUDENT,
      profile: {
        create: {
          name: 'Synthetic user',
          studentId: (githubIdBase / 1000n).toString().padStart(10, '0'),
          department: 'Synthetic',
          memberKind: MemberKind.STUDENT,
          affiliationKind: AffiliationKind.DEPARTMENT,
          affiliationName: 'Synthetic',
        },
      },
    },
  });
});
beforeEach(async () => {
  caseNumber += 1;
  programId = `${prefix}-${caseNumber}-program`;
  applicationId = `${prefix}-${caseNumber}-application`;
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
      joinCodeDigest: `${teamId}-digest`,
      leaderId: userId,
    },
  });
  await prisma.teamMember.create({ data: { teamId, programId, userId } });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      teamId,
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
      applicationId,
      programId,
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
  await prisma.repositoryProvisionJob.deleteMany({ where: { applicationId } });
});
afterAll(async () => {
  await prisma.$disconnect();
});

export {
  prisma,
  service,
  repository,
  applications,
  audit,
  resolver,
  githubId,
  programId,
  applicationId,
  teamId,
  oldId,
  targetId,
  targetGithubId,
  input,
};
