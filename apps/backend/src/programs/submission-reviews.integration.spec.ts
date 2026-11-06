import { FileMetadataRepository } from './files.repository';
import { SubmissionFileAdmissionService } from './files.service';
import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { randomUUID } from 'node:crypto';
import {
  AccountStatus,
  ApplicationStatus,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
  TeamHistoryEvent,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import {
  prisma as seedPrisma,
  seedGithubId,
  seedId,
  seedNameWithOwner,
  seedRepositoryId,
  SeedStats,
} from '../../prisma/seeds/helpers';
import { seedMilestones } from '../../prisma/seeds/milestones';
import { seedRepositories } from '../../prisma/seeds/repositories';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { type GithubAppClient } from '../github/github-app.client';
import { BarrierRepositoriesRepository } from '../github/repositories.integration-support';
import { RepositoriesRepository } from '../github/repositories.repository';
import { RepositoriesService } from '../github/repositories.service';
import { PublicProjectsRepository } from './public-projects.repository';
import { SubmissionReviewsErrorCode } from './submission-reviews-error-code.error';
import { SubmissionReviewsRepository } from './submission-reviews.repository';
import { SubmissionReviewsService } from './submission-reviews.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { MilestoneCompletionService } from './milestone-completion.service';

const repositoryUrlService = new RepositoryUrlService();
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const github = {
  publishRepository: jest.fn(),
} as jest.Mocked<Pick<GithubAppClient, 'publishRepository'>>;
const repositoriesRepository = new RepositoriesRepository(
  prisma,
  new RepositoryProvisionGenerationRepository(),
);
const repositories = new RepositoriesService(
  repositoriesRepository,
  github as unknown as GithubAppClient,
  new HistoryMetadataService(),
  new RepositoryUrlService(),
);
const service = new SubmissionReviewsService(
  new SubmissionReviewsRepository(prisma, new PlatformRepository()),
  repositories,
  new RepositoryPublishService(),
  new RepositoryUrlService(),
  new MilestoneCompletionService(),
  new SubmissionFileAdmissionService(),
  new FileMetadataRepository(),
);
const publicProjects = new PublicProjectsRepository(prisma);
const PROGRAM_ID = seedId('milestones', 'program');
const REPOSITORIES_PROGRAM_ID = seedId('repositories', 'program');
const REVIEWER_ID = seedId('milestones', 'user', 'reviewer');
const REVIEWER_GITHUB_ID = seedGithubId(REVIEWER_ID);
const EXISTING_SUBMISSION_ID = seedId(
  'milestones',
  'submission-existing',
  'submission',
);
const CHANGES_REQUESTED_SUBMISSION_ID = seedId(
  'milestones',
  'submission-changes-requested',
  'submission',
);
async function createFreshPrivateRepository(): Promise<{
  readonly repositoryId: string;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly name: string;
  readonly url: string;
}> {
  const scenarioId = `concurrent-publish-${randomUUID()}`;
  const applicantId = seedId('repositories', scenarioId, 'applicant');
  await prisma.user.create({
    data: {
      id: applicantId,
      githubId: seedGithubId(applicantId),
      nickname: applicantId.replace(/:/g, '-'),
      accountStatus: AccountStatus.ACTIVE,
      type: MemberKind.STUDENT,
      approvalStatus: 'NOT_REQUIRED',
    },
  });
  const teamId = seedId('repositories', scenarioId, 'application');
  await prisma.team.create({
    data: {
      id: teamId,
      programId: REPOSITORIES_PROGRAM_ID,
      name: `${scenarioId} 1인 팀`,
      leaderId: applicantId,
      applicantId: applicantId,
      answers: { title: `${scenarioId} 1인 팀` },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId,
      programId: REPOSITORIES_PROGRAM_ID,
      userId: applicantId,
    },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId: REPOSITORIES_PROGRAM_ID,
      applicantId,
      answers: { seedPlaceholder: true, scenarioId },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      processedAt: new Date(),
    },
  });
  const repositoryId = seedId('repositories', scenarioId, 'repository');
  const githubRepositoryId = seedRepositoryId(scenarioId);
  const nameWithOwner = seedNameWithOwner(scenarioId);
  const name =
    repositoryUrlService.repositoryNameFromNameWithOwner(nameWithOwner);
  const url =
    repositoryUrlService.repositoryUrlFromNameWithOwner(nameWithOwner);
  await prisma.githubRepository.create({
    data: {
      id: repositoryId,
      teamId,
      githubRepositoryId,
      nameWithOwner,
      source: RepositorySource.ORG_PROVISIONED,
      visibility: RepositoryVisibility.PRIVATE,
    },
  });
  await prisma.repositoryProvisionJob.create({
    data: {
      id: seedId('repositories', scenarioId, 'job'),
      teamId,
      repositoryId,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      nextAttemptAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  });
  return { repositoryId, githubRepositoryId, nameWithOwner, name, url };
}
describe('SubmissionReviewsService integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await seedMilestones(new SeedStats());
    await seedRepositories(new SeedStats());
  });
  beforeEach(() => github.publishRepository.mockReset());
  afterAll(async () => {
    await prisma.submissionHistory.deleteMany({
      where: {
        submission: {
          requirement: { milestone: { programId: PROGRAM_ID } },
        },
      },
    });
    await prisma.submission.deleteMany({
      where: { requirement: { milestone: { programId: PROGRAM_ID } } },
    });
    await prisma.file.deleteMany({
      where: {
        kind: 'SUBMISSION',
        submission: {
          requirement: { milestone: { programId: PROGRAM_ID } },
        },
      },
    });
    await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.requirement.deleteMany({
      where: { milestone: { programId: PROGRAM_ID } },
    });
    await prisma.milestone.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
    await prisma.repositoryInvitation.deleteMany({
      where: { repository: { team: { programId: REPOSITORIES_PROGRAM_ID } } },
    });
    await prisma.repositoryProvisionJob.deleteMany({
      where: { team: { programId: REPOSITORIES_PROGRAM_ID } },
    });
    await prisma.githubRepository.deleteMany({
      where: { team: { programId: REPOSITORIES_PROGRAM_ID } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { startsWith: seedId('repositories') } },
    });
    await prisma.teamMember.deleteMany({
      where: { programId: REPOSITORIES_PROGRAM_ID },
    });
    await prisma.team.deleteMany({
      where: { programId: REPOSITORIES_PROGRAM_ID },
    });
    await prisma.program.deleteMany({ where: { id: REPOSITORIES_PROGRAM_ID } });
    await prisma.user.deleteMany({
      where: {
        OR: [
          {
            id: { startsWith: seedId('milestones', 'user'), not: REVIEWER_ID },
          },
          { id: { startsWith: seedId('repositories') } },
        ],
      },
    });
    await prisma.$disconnect();
    await seedPrisma.$disconnect();
  });
  it('seed 팀형 최신 revision 판정을 트랜잭션으로 저장하고 중복을 막는다', async () => {
    const before = await service.context(EXISTING_SUBMISSION_ID);
    expect(before.application).toMatchObject({
      applicationMode: 'TEAM',
      displayName: 'seed-milestones-team',
    });
    expect(before.currentRevision.review).toBeNull();
    await service.review(REVIEWER_ID, EXISTING_SUBMISSION_ID, {
      revision: 1,
      decision: ReviewDecision.APPROVED,
      comment: null,
    });
    await expect(
      prisma.submission.findUniqueOrThrow({
        where: { id: EXISTING_SUBMISSION_ID },
        select: {
          status: true,
          histories: {
            where: { event: 'APPROVED' },
            select: { event: true },
          },
        },
      }),
    ).resolves.toMatchObject({
      status: SubmissionStatus.APPROVED,
      histories: [{ event: ReviewDecision.APPROVED }],
    });
    await expect(
      service.review(REVIEWER_ID, EXISTING_SUBMISSION_ID, {
        revision: 1,
        decision: ReviewDecision.APPROVED,
        comment: null,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.ALREADY_REVIEWED },
    });
  });
  it('seed 보완요청의 판정 코멘트를 검토 문맥에 보존한다', async () => {
    const context = await service.context(CHANGES_REQUESTED_SUBMISSION_ID);
    expect(context.currentRevision.review).toMatchObject({
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '누락된 항목을 보완해 재제출해 주세요 (seed fixture)',
    });
  });
  it('provision 성공 seed 저장소를 공개하고 DB 상태를 갱신하며 정확히 1건의 typed audit을 남긴다', async () => {
    const scenarioId = 'repo-job-succeeded';
    const repositoryId = seedId('repositories', scenarioId, 'repository');
    const repository = await prisma.githubRepository.findUniqueOrThrow({
      where: { id: repositoryId },
    });
    const repositoryName = repositoryUrlService.repositoryNameFromNameWithOwner(
      repository.nameWithOwner,
    );
    github.publishRepository.mockResolvedValue({
      githubRepositoryId: repository.githubRepositoryId,
      nameWithOwner: repository.nameWithOwner,
      name: repositoryName,
      url: repositoryUrlService.repositoryUrlFromNameWithOwner(
        repository.nameWithOwner,
      ),
      visibility: RepositoryVisibility.PUBLIC,
      description: null,
    });
    await service.publishRepository(repositoryId, REVIEWER_GITHUB_ID);
    const published = await prisma.githubRepository.findUniqueOrThrow({
      where: { id: repositoryId },
    });
    expect(published.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(github.publishRepository).toHaveBeenCalledWith(repositoryName);
    const historyRows = await prisma.teamHistory.findMany({
      where: {
        event: TeamHistoryEvent.REPOSITORY_PUBLISHED,
        data: { path: ['targetId'], equals: repositoryId },
      },
    });
    expect(historyRows).toHaveLength(1);
    const publicRow = await publicProjects.findById(
      repository.githubRepositoryId.toString(),
    );
    expect(publicRow).not.toBeNull();
    expect(publicRow?.publishedAt).toEqual(published.publishedAt);
  });
  it('provision job이 없는 repository-ready seed는 공개를 막고 GitHub를 호출하지 않으며 이력도 남기지 않는다', async () => {
    const repositoryId = seedId(
      'repositories',
      'repository-ready',
      'repository',
    );
    await expect(
      service.publishRepository(repositoryId, REVIEWER_GITHUB_ID),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY },
    });
    expect(github.publishRepository).not.toHaveBeenCalled();
    const historyRows = await prisma.teamHistory.findMany({
      where: {
        event: TeamHistoryEvent.REPOSITORY_PUBLISHED,
        data: { path: ['targetId'], equals: repositoryId },
      },
    });
    expect(historyRows).toHaveLength(0);
  });
  it('이미 public인 seed 저장소는 반복 요청에도 외부 호출 없이 수렴한다', async () => {
    const target = await createFreshPrivateRepository();
    await prisma.githubRepository.update({
      where: { id: target.repositoryId },
      data: {
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    const first = await service.publishRepository(
      target.repositoryId,
      REVIEWER_GITHUB_ID,
    );
    const second = await service.publishRepository(
      target.repositoryId,
      REVIEWER_GITHUB_ID,
    );
    expect(first.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(second).toEqual(first);
    expect(github.publishRepository).not.toHaveBeenCalled();
  });
  it('동시에 두 요청이 경합해도 정확히 1건의 typed audit만 남고, 패자는 승자가 커밋한 상태를 재조회하며 공개 조회에 즉시 반영된다', async () => {
    const target = await createFreshPrivateRepository();
    const barrierRepository = new BarrierRepositoriesRepository(
      repositoriesRepository,
    );
    const concurrentRepositories = new RepositoriesService(
      barrierRepository as unknown as RepositoriesRepository,
      github as unknown as GithubAppClient,
      new HistoryMetadataService(),
      new RepositoryUrlService(),
    );
    const publishedAt = new Date('2026-07-31T00:00:00.000Z');
    github.publishRepository.mockResolvedValue({
      githubRepositoryId: target.githubRepositoryId,
      nameWithOwner: target.nameWithOwner,
      name: target.name,
      url: target.url,
      visibility: RepositoryVisibility.PUBLIC,
      description: null,
    });
    const beforePublish = await publicProjects.findById(
      target.githubRepositoryId.toString(),
    );
    expect(beforePublish).toBeNull();
    const [first, second] = await Promise.all([
      concurrentRepositories.publish(
        { repositoryId: target.repositoryId },
        REVIEWER_GITHUB_ID,
        publishedAt,
      ),
      concurrentRepositories.publish(
        { repositoryId: target.repositoryId },
        REVIEWER_GITHUB_ID,
        publishedAt,
      ),
    ]);
    expect(first.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(second.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(first.publishedAt).toEqual(publishedAt);
    expect(second.publishedAt).toEqual(publishedAt);
    const finalRepository = await prisma.githubRepository.findUniqueOrThrow({
      where: { id: target.repositoryId },
    });
    expect(finalRepository.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(finalRepository.publishedAt).toEqual(publishedAt);
    const historyRows = await prisma.teamHistory.findMany({
      where: {
        event: TeamHistoryEvent.REPOSITORY_PUBLISHED,
        data: { path: ['targetId'], equals: target.repositoryId },
      },
    });
    expect(historyRows).toHaveLength(1);
    const publicRow = await publicProjects.findById(
      target.githubRepositoryId.toString(),
    );
    expect(publicRow).not.toBeNull();
    expect(publicRow?.publishedAt).toEqual(publishedAt);
  });
});
