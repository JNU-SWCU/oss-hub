import {
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import {
  prisma as seedPrisma,
  seedId,
  SeedStats,
} from '../../prisma/seeds/helpers';
import {
  MILESTONE_SCENARIOS,
  seedMilestones,
} from '../../prisma/seeds/milestones';
import { seedRepositories } from '../../prisma/seeds/repositories';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { GithubAppClient } from '../repositories/github-app.client';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { RepositoriesService } from '../repositories/repositories.service';
import { SubmissionReviewsErrorCode } from './submission-reviews-error-code.enum';
import { SubmissionReviewsRepository } from './submission-reviews.repository';
import { SubmissionReviewsService } from './submission-reviews.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const github = {
  publishRepository: jest.fn(),
} as jest.Mocked<Pick<GithubAppClient, 'publishRepository'>>;
const repositories = new RepositoriesService(
  new RepositoriesRepository(prisma),
  github,
);
const service = new SubmissionReviewsService(
  new SubmissionReviewsRepository(prisma),
  repositories,
);
const PROGRAM_ID = seedId('milestones', 'program');
const REPOSITORIES_PROGRAM_ID = seedId('repositories', 'program');
const REVIEWER_ID = seedId('milestones', 'user', 'reviewer');
const EXISTING_SUBMISSION_ID = seedId(
  'milestones',
  'submission-existing',
  'submission',
);

describe('SubmissionReviewsService integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await seedMilestones(new SeedStats());
    await seedRepositories(new SeedStats());
  });

  beforeEach(() => github.publishRepository.mockReset());

  afterAll(async () => {
    await prisma.review.deleteMany({
      where: {
        submissionRevision: {
          submission: { milestone: { programId: PROGRAM_ID } },
        },
      },
    });
    await prisma.submissionFile.deleteMany({
      where: {
        submissionRevision: {
          submission: { milestone: { programId: PROGRAM_ID } },
        },
      },
    });
    await prisma.submissionRevision.deleteMany({
      where: { submission: { milestone: { programId: PROGRAM_ID } } },
    });
    await prisma.submission.deleteMany({
      where: { milestone: { programId: PROGRAM_ID } },
    });
    await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.milestone.deleteMany({ where: { programId: PROGRAM_ID } });
    await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
    await prisma.repositoryInvitation.deleteMany({
      where: { repository: { programId: REPOSITORIES_PROGRAM_ID } },
    });
    await prisma.repositoryProvisionJob.deleteMany({
      where: { application: { programId: REPOSITORIES_PROGRAM_ID } },
    });
    await prisma.repository.deleteMany({
      where: { programId: REPOSITORIES_PROGRAM_ID },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { startsWith: seedId('repositories') } },
    });
    await prisma.application.deleteMany({
      where: { programId: REPOSITORIES_PROGRAM_ID },
    });
    await prisma.program.deleteMany({ where: { id: REPOSITORIES_PROGRAM_ID } });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { startsWith: seedId('milestones', 'user') } },
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
          revisions: { select: { review: { select: { decision: true } } } },
        },
      }),
    ).resolves.toMatchObject({
      status: SubmissionStatus.APPROVED,
      revisions: [{ review: { decision: ReviewDecision.APPROVED } }],
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
    const [milestoneId] = MILESTONE_SCENARIOS['submission-changes-requested'];
    const submission = await prisma.submission.findFirstOrThrow({
      where: { milestoneId },
      select: { id: true },
    });

    const context = await service.context(submission.id);

    expect(context.currentRevision.review).toMatchObject({
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '누락된 항목을 보완해 재제출해 주세요 (seed fixture)',
    });
  });

  it('provision 성공 seed 저장소를 공개하고 DB 상태를 갱신한다', async () => {
    const scenarioId = 'repo-job-succeeded';
    const repositoryId = seedId('repositories', scenarioId, 'repository');
    const repository = await prisma.repository.findUniqueOrThrow({
      where: { id: repositoryId },
    });
    github.publishRepository.mockResolvedValue({
      githubRepositoryId: repository.githubRepositoryId,
      name: repository.name,
      url: repository.url,
      visibility: RepositoryVisibility.PUBLIC,
      description: null,
    });

    await service.publishRepository(repositoryId);

    const published = await prisma.repository.findUniqueOrThrow({
      where: { id: repositoryId },
    });
    expect(published.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(github.publishRepository).toHaveBeenCalledWith(repository.name);
  });

  it('provision job이 없는 repository-ready seed는 공개를 막는다', async () => {
    const repositoryId = seedId(
      'repositories',
      'repository-ready',
      'repository',
    );

    await expect(service.publishRepository(repositoryId)).rejects.toMatchObject(
      {
        errorCode: { code: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY },
      },
    );
    expect(github.publishRepository).not.toHaveBeenCalled();
  });

  it('이미 public인 seed 저장소는 반복 요청에도 외부 호출 없이 수렴한다', async () => {
    const repositoryId = seedId(
      'repositories',
      'repository-public',
      'repository',
    );

    const first = await service.publishRepository(repositoryId);
    const second = await service.publishRepository(repositoryId);

    expect(first.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(second).toEqual(first);
    expect(github.publishRepository).not.toHaveBeenCalled();
  });
});
