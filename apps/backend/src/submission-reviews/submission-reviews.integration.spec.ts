import { randomUUID } from 'node:crypto';
import {
  AccountStatus,
  ApplicationStatus,
  Role,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { REPOSITORY_PUBLISH_AUDIT_ACTIONS } from '../audit-log/audit-log-metadata';
import {
  prisma as seedPrisma,
  seedFixtureUrl,
  seedGithubId,
  seedId,
  seedRepositoryId,
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
import { BarrierRepositoriesRepository } from '../repositories/repositories.integration-support';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { RepositoriesService } from '../repositories/repositories.service';
import { PublicProjectsRepository } from '../public-projects/public-projects.repository';
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
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
const repositoriesRepository = new RepositoriesRepository(prisma);
const repositories = new RepositoriesService(
  repositoriesRepository,
  github,
  auditLog,
);
const service = new SubmissionReviewsService(
  new SubmissionReviewsRepository(prisma),
  repositories,
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

/**
 * todo 20 — 경합 테스트 전용 fresh PRIVATE repository. `repo-job-succeeded` seed는 다른
 * 테스트가 이미 PUBLIC으로 전이시키므로 재사용하지 않는다. 매 호출마다 고유한 slug를 써서
 * 재실행 시 unique 충돌 없이 안전하고, afterAll의 `programId: REPOSITORIES_PROGRAM_ID`/
 * `startsWith: seedId('repositories')` 정리 질의가 그대로 이 row들을 쓸어간다.
 */
async function createFreshPrivateRepository(): Promise<{
  readonly repositoryId: string;
  readonly githubRepositoryId: bigint;
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
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  const applicationId = seedId('repositories', scenarioId, 'application');
  await prisma.application.create({
    data: {
      id: applicationId,
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
  const name = `seed-${scenarioId}`;
  const url = seedFixtureUrl(scenarioId);
  await prisma.repository.create({
    data: {
      id: repositoryId,
      applicationId,
      programId: REPOSITORIES_PROGRAM_ID,
      githubRepositoryId,
      name,
      url,
      visibility: RepositoryVisibility.PRIVATE,
    },
  });
  await prisma.repositoryProvisionJob.create({
    data: {
      id: seedId('repositories', scenarioId, 'job'),
      applicationId,
      repositoryId,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      nextAttemptAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  });
  return { repositoryId, githubRepositoryId, name, url };
}

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
    // AuditLog는 DB 레벨에서 append-only로 강제된다(DELETE 자체가 거부됨) — 이 테스트가
    // 남긴 typed audit row는 정리 대상에서 제외한다. 대신 그 audit들의 actor인
    // REVIEWER_ID는 FK로 영구 고정되므로 아래 user 정리에서 제외한다(seed는 upsert라
    // 다음 실행에서도 안전하다).
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

  it('provision 성공 seed 저장소를 공개하고 DB 상태를 갱신하며 정확히 1건의 typed audit을 남긴다', async () => {
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

    await service.publishRepository(repositoryId, REVIEWER_GITHUB_ID);

    const published = await prisma.repository.findUniqueOrThrow({
      where: { id: repositoryId },
    });
    expect(published.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(github.publishRepository).toHaveBeenCalledWith(repository.name);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        targetType: 'REPOSITORY',
        targetId: repositoryId,
        action: REPOSITORY_PUBLISH_AUDIT_ACTIONS.REPOSITORY_PUBLISHED,
      },
    });
    expect(auditRows).toHaveLength(1);

    const publicRow = await publicProjects.findById(
      repository.githubRepositoryId.toString(),
    );
    expect(publicRow).not.toBeNull();
    expect(publicRow?.publishedAt).toEqual(published.publishedAt);
  });

  it('provision job이 없는 repository-ready seed는 공개를 막고 GitHub를 호출하지 않으며 audit도 남기지 않는다', async () => {
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

    const auditRows = await prisma.auditLog.findMany({
      where: {
        targetType: 'REPOSITORY',
        targetId: repositoryId,
        action: REPOSITORY_PUBLISH_AUDIT_ACTIONS.REPOSITORY_PUBLISHED,
      },
    });
    expect(auditRows).toHaveLength(0);
  });

  it('이미 public인 seed 저장소는 반복 요청에도 외부 호출 없이 수렴한다', async () => {
    // repository-public seed는 공개 아카이브 노출에서 의도적으로 제외되도록
    // publishedAt: null을 유지한다(repositories.ts 주석 참고) — 그래서 이 테스트는
    // "이미 PUBLIC" 상태만 필요한 별도 fixture를 직접 만들어 그 불변식과 분리한다.
    const target = await createFreshPrivateRepository();
    await prisma.repository.update({
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
      barrierRepository,
      github,
      auditLog,
    );
    const publishedAt = new Date('2026-07-31T00:00:00.000Z');
    github.publishRepository.mockResolvedValue({
      githubRepositoryId: target.githubRepositoryId,
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

    const finalRepository = await prisma.repository.findUniqueOrThrow({
      where: { id: target.repositoryId },
    });
    expect(finalRepository.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(finalRepository.publishedAt).toEqual(publishedAt);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        targetType: 'REPOSITORY',
        targetId: target.repositoryId,
        action: REPOSITORY_PUBLISH_AUDIT_ACTIONS.REPOSITORY_PUBLISHED,
      },
    });
    expect(auditRows).toHaveLength(1);

    const publicRow = await publicProjects.findById(
      target.githubRepositoryId.toString(),
    );
    expect(publicRow).not.toBeNull();
    expect(publicRow?.publishedAt).toEqual(publishedAt);
  });
});
