import {
  ApplicationStatus,
  OutboxEventStatus,
  ProgramCategory,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  Role,
} from '@prisma/client';
import {
  offsetDays,
  prisma,
  seedFixtureUrl,
  seedId,
  seedRepositoryId,
  SeedStats,
  upsertSeedUser,
  upsertTracked,
} from './helpers';

/**
 * repositories profile도 intake/milestones 없이 빈 DB에서 단독 성공해야 한다
 * (#110 완료 조건) — 자체 Program·Application backbone을 이 파일 안에서 만든다.
 * 실제 GitHub API 호출은 이 시드가 하지 않는다(#121/#120 소유) — 아래 값은 전부
 * 명백한 fixture다.
 */
const PROGRAM_ID = seedId('repositories', 'program');

async function ensureProgram(stats: SeedStats): Promise<void> {
  await upsertTracked(
    stats,
    'Program',
    () => prisma.program.findUnique({ where: { id: PROGRAM_ID } }),
    () =>
      prisma.program.upsert({
        where: { id: PROGRAM_ID },
        update: {},
        create: {
          id: PROGRAM_ID,
          name: 'seed-repositories-program',
          organizer: 'seed-organizer',
          category: ProgramCategory.OSS_CONTEST,
          applicationTemplateKey: ProgramCategory.OSS_CONTEST.toLowerCase(),
          applicationTemplateVersion: 1,
          applicationStartAt: offsetDays(-40),
          applicationEndAt: offsetDays(40),
          // todo 20 — 수동 공개 게이트가 endAt 경과를 요구한다: 시드는 이미 종료된 프로그램이어야
          // repo-job-succeeded 시나리오가 공개 가능 상태로 남는다.
          endAt: offsetDays(-1),
          repositoryProvisioningEnabled: true,
          description: '#110 시드 fixture — repositories profile 전용',
        },
      }),
  );
}

async function ensureApplication(
  stats: SeedStats,
  scenarioId: string,
): Promise<{ applicationId: string; applicantId: string }> {
  const applicant = await upsertSeedUser(stats, {
    id: seedId('repositories', scenarioId, 'applicant'),
    role: Role.STUDENT,
  });
  const applicationId = seedId('repositories', scenarioId, 'application');
  await upsertTracked(
    stats,
    'Application',
    () => prisma.application.findUnique({ where: { id: applicationId } }),
    () =>
      prisma.application.upsert({
        where: { id: applicationId },
        update: {},
        create: {
          id: applicationId,
          programId: PROGRAM_ID,
          applicantId: applicant.id,
          answers: { seedPlaceholder: true, scenarioId },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
          processedAt: offsetDays(-2),
        },
      }),
  );
  return { applicationId, applicantId: applicant.id };
}

async function seedRepoJobPending(stats: SeedStats): Promise<void> {
  const scenarioId = 'repo-job-pending';
  const { applicationId } = await ensureApplication(stats, scenarioId);

  const outboxId = seedId('repositories', scenarioId, 'outbox-event');
  await upsertTracked(
    stats,
    'OutboxEvent',
    () => prisma.outboxEvent.findUnique({ where: { id: outboxId } }),
    () =>
      prisma.outboxEvent.upsert({
        where: { id: outboxId },
        update: { status: OutboxEventStatus.PROCESSED },
        create: {
          id: outboxId,
          type: 'repository.provision.requested',
          aggregateType: 'Application',
          aggregateId: applicationId,
          idempotencyKey: seedId('repositories', scenarioId, 'idempotency'),
          payload: { seedPlaceholder: true, scenarioId },
          status: OutboxEventStatus.PROCESSED,
          processedAt: offsetDays(-1),
        },
      }),
  );

  const jobId = seedId('repositories', scenarioId, 'job');
  await upsertTracked(
    stats,
    'RepositoryProvisionJob',
    () => prisma.repositoryProvisionJob.findUnique({ where: { id: jobId } }),
    () =>
      prisma.repositoryProvisionJob.upsert({
        where: { id: jobId },
        update: { status: RepositoryProvisionJobStatus.PENDING },
        create: {
          id: jobId,
          applicationId,
          status: RepositoryProvisionJobStatus.PENDING,
          nextAttemptAt: offsetDays(0),
        },
      }),
  );
}

async function seedRepoJobSucceeded(stats: SeedStats): Promise<void> {
  const scenarioId = 'repo-job-succeeded';
  const { applicationId } = await ensureApplication(stats, scenarioId);

  const repositoryId = seedId('repositories', scenarioId, 'repository');
  await upsertTracked(
    stats,
    'Repository',
    () => prisma.repository.findUnique({ where: { id: repositoryId } }),
    () =>
      prisma.repository.upsert({
        where: { id: repositoryId },
        update: {},
        create: {
          id: repositoryId,
          applicationId,
          programId: PROGRAM_ID,
          githubRepositoryId: seedRepositoryId(scenarioId),
          name: `seed-${scenarioId}`,
          url: seedFixtureUrl(scenarioId),
          visibility: RepositoryVisibility.PRIVATE,
        },
      }),
  );

  const jobId = seedId('repositories', scenarioId, 'job');
  await upsertTracked(
    stats,
    'RepositoryProvisionJob',
    () => prisma.repositoryProvisionJob.findUnique({ where: { id: jobId } }),
    () =>
      prisma.repositoryProvisionJob.upsert({
        where: { id: jobId },
        update: { status: RepositoryProvisionJobStatus.SUCCEEDED },
        create: {
          id: jobId,
          applicationId,
          repositoryId,
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          nextAttemptAt: offsetDays(-1),
          startedAt: offsetDays(-1),
          finishedAt: offsetDays(-1),
        },
      }),
  );
}

async function seedRepoJobFailedRetryable(stats: SeedStats): Promise<void> {
  const scenarioId = 'repo-job-failed-retryable';
  const { applicationId } = await ensureApplication(stats, scenarioId);

  const jobId = seedId('repositories', scenarioId, 'job');
  await upsertTracked(
    stats,
    'RepositoryProvisionJob',
    () => prisma.repositoryProvisionJob.findUnique({ where: { id: jobId } }),
    () =>
      prisma.repositoryProvisionJob.upsert({
        where: { id: jobId },
        update: {
          status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
          attemptCount: 2,
        },
        create: {
          id: jobId,
          applicationId,
          status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
          attemptCount: 2,
          lastErrorCode: 'PROVISION_TIMEOUT',
          lastErrorMessage: 'seed fixture: 저장소 생성 타임아웃',
          nextAttemptAt: offsetDays(1),
        },
      }),
  );
}

async function seedRepositoryReady(stats: SeedStats): Promise<void> {
  const scenarioId = 'repository-ready';
  const { applicationId, applicantId } = await ensureApplication(
    stats,
    scenarioId,
  );

  const repositoryId = seedId('repositories', scenarioId, 'repository');
  await upsertTracked(
    stats,
    'Repository',
    () => prisma.repository.findUnique({ where: { id: repositoryId } }),
    () =>
      prisma.repository.upsert({
        where: { id: repositoryId },
        update: {},
        create: {
          id: repositoryId,
          applicationId,
          programId: PROGRAM_ID,
          githubRepositoryId: seedRepositoryId(scenarioId),
          name: `seed-${scenarioId}`,
          url: seedFixtureUrl(scenarioId),
          visibility: RepositoryVisibility.PRIVATE,
        },
      }),
  );

  const invitationId = seedId('repositories', scenarioId, 'invitation');
  const invitedUser = await prisma.user.findUnique({
    where: { id: applicantId },
  });
  const githubLogin = invitedUser?.nickname ?? `seed-${scenarioId}-invitee`;
  await upsertTracked(
    stats,
    'RepositoryInvitation',
    () =>
      prisma.repositoryInvitation.findUnique({ where: { id: invitationId } }),
    () =>
      prisma.repositoryInvitation.upsert({
        where: { id: invitationId },
        update: { status: RepositoryInvitationStatus.PENDING },
        create: {
          id: invitationId,
          repositoryId,
          githubLogin,
          status: RepositoryInvitationStatus.PENDING,
          attemptCount: 1,
        },
      }),
  );
}

/**
 * `visibility: PUBLIC`이지만 의도적으로 `publishedAt: null`이다 — 공개 아카이브
 * (`GET /api/v1/projects`)의 platform-public 원본 질의는 `publishedAt: { not: null }`도
 * 함께 요구하므로, 이 fixture는 "공개 전이는 됐지만 아직 발행 시각이 찍히지 않은" 내부
 * 상태 검증에만 쓰이고 공개 API에는 절대 노출되지 않는다. 합성 fixture URL을 실제
 * `https://github.com/JNU-SWCU/...`처럼 보이게 바꾸지 않는다(반쪽짜리 실제 데이터 금지,
 * `AGENTS.md` antipattern #2).
 */
async function seedRepositoryPublic(stats: SeedStats): Promise<void> {
  const scenarioId = 'repository-public';
  const { applicationId } = await ensureApplication(stats, scenarioId);

  const repositoryId = seedId('repositories', scenarioId, 'repository');
  await upsertTracked(
    stats,
    'Repository',
    () => prisma.repository.findUnique({ where: { id: repositoryId } }),
    () =>
      prisma.repository.upsert({
        where: { id: repositoryId },
        update: { publishedAt: null },
        create: {
          id: repositoryId,
          applicationId,
          programId: PROGRAM_ID,
          githubRepositoryId: seedRepositoryId(scenarioId),
          name: `seed-${scenarioId}`,
          url: seedFixtureUrl(scenarioId),
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: null,
        },
      }),
  );
}

export async function seedRepositories(stats: SeedStats): Promise<void> {
  await ensureProgram(stats);
  await seedRepoJobPending(stats);
  await seedRepoJobSucceeded(stats);
  await seedRepoJobFailedRetryable(stats);
  await seedRepositoryReady(stats);
  await seedRepositoryPublic(stats);
}
