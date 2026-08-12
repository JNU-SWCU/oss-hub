import { seedAuth } from './seeds/auth';
import {
  assertOssHubSeedAllowed,
  assertSeedAllowed,
  parseOssHubTeamAccounts,
  prisma,
  resolveSeedProfile,
  resolveTeardownFlag,
  SeedProfile,
  SeedStats,
  seedNow,
} from './seeds/helpers';
import { seedDemo, teardownDemo } from './seeds/demo';
import { seedIntake } from './seeds/intake';
import { seedMilestones } from './seeds/milestones';
import { seedOssHub } from './seeds/oss-hub';
import { seedProgramOverview } from './seeds/program-overview';
import { seedRepositories } from './seeds/repositories';
import { backfillUserProfiles } from './user-profile-backfill';
import { S3SubmissionFileStorage } from '../src/submissions/s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../src/submissions/submission-file-storage.config';
import type { SubmissionFileStoragePort } from '../src/submissions/submission-file-storage.port';

/**
 * demo profile만 `S3SubmissionFileStorage`를 쓴다(#910/#913 파인딩 4) — 실제 앱이
 * SubmissionFile storage에 쓰는 같은 포트/어댑터를 재사용해 seed FILE 제출이 실제
 * 검색 가능한 객체를 갖도록 한다. `reconcile-storage-orphans.ts` CLI와 동일하게
 * Nest DI 밖에서 직접 생성한다 — Prisma 시드와 동일한 단독 스크립트 실행 문맥.
 */
function createSubmissionFileStorage(): SubmissionFileStoragePort {
  return new S3SubmissionFileStorage(new SubmissionFileStorageConfig());
}

/**
 * #110 시드 진입점. 실행 계약:
 *   SEED_PROFILE=<profile> pnpm --filter backend prisma db seed
 *   pnpm --filter backend prisma db seed -- --profile <profile>
 * profile: auth | intake | milestones | repositories | program-overview | oss-hub | demo | all
 * (기본값 auth — 안전한 최소). 자세한 시나리오 카탈로그는 apps/backend/prisma/README.md 참조.
 *
 * `demo`는 `oss-hub`와 마찬가지로 `all`에 포함되지 않는다 — 명시적으로
 * `--profile demo`를 고를 때만 실행된다(qa-econovation-batch TODO 11).
 */
export async function runProfile(
  profile: SeedProfile,
  stats: SeedStats,
): Promise<void> {
  if (profile === 'oss-hub') {
    assertOssHubSeedAllowed(
      process.env.NODE_ENV,
      process.env.OSS_HUB_SEED_CONFIRMATION,
    );
  }
  const ossHubAccounts =
    profile === 'oss-hub'
      ? parseOssHubTeamAccounts(process.env.OSS_HUB_TEAM_ACCOUNTS)
      : undefined;
  if (profile === 'auth' || profile === 'oss-hub' || profile === 'all') {
    await seedAuth(stats);
  }
  if (profile === 'intake' || profile === 'all') {
    await seedIntake(stats);
  }
  if (profile === 'milestones' || profile === 'all') {
    await seedMilestones(stats);
  }
  if (profile === 'repositories' || profile === 'all') {
    await seedRepositories(stats);
  }
  if (profile === 'program-overview' || profile === 'all') {
    await seedProgramOverview(stats);
  }
  if (profile === 'oss-hub' && ossHubAccounts) {
    await seedOssHub(stats, ossHubAccounts);
  }
  if (profile === 'demo') {
    await seedDemo(stats, createSubmissionFileStorage());
  }
  // production에서는 demo profile만 예외적으로 실행된다(assertSeedAllowed).
  // 이 경로의 backfill은 그 예외가 만든 seed:demo:* 행만 만져야 한다 — 전체
  // User를 스캔하면 이미 존재하는 비-demo production 사용자(예: 수동 교정된 OAuth
  // 계정)의 legacy 프로필 불일치(PROFILE_MISMATCH 등)가 demo 시드 실행을 통째로
  // 실패시키고, 그 사용자의 프로필을 쓰지도 않는다(프로덕션 장애 사례).
  // production 외(demo의 기본 경로 포함)와 다른 모든 profile은 기존과 동일하게
  // 전체 User를 대상으로 backfill한다.
  const isProductionDemoSeed =
    profile === 'demo' && process.env.NODE_ENV === 'production';
  await backfillUserProfiles(
    prisma,
    isProductionDemoSeed ? { userIdPrefix: 'seed:demo:' } : {},
  );
}

/**
 * `--teardown`(TODO 15) 은 현재 `demo` profile만 지원한다. production에서도
 * 시드와 동일한 `assertSeedAllowed` 게이트(`SEED_DEMO_ALLOW_PRODUCTION=1`)를 통과해야
 * 실행된다 — 새 시드 예외를 추가하지 않는다.
 */
export async function runTeardown(
  profile: SeedProfile,
  stats: SeedStats,
): Promise<void> {
  if (profile !== 'demo') {
    throw new Error(
      `--teardown은 현재 demo profile만 지원합니다 (입력: "${profile}").`,
    );
  }
  await teardownDemo(stats, createSubmissionFileStorage());
}

async function main(): Promise<void> {
  const profile = resolveSeedProfile();
  assertSeedAllowed(process.env.NODE_ENV, profile);
  const teardown = resolveTeardownFlag();
  const stats = new SeedStats();

  if (teardown) {
    console.log(
      `[seed] teardown profile=${profile} SEED_NOW=${seedNow().toISOString()}`,
    );
    await runTeardown(profile, stats);
    console.log(`[seed] teardown 완료 (profile=${profile})`);
    console.log(stats.report());
    return;
  }

  console.log(`[seed] profile=${profile} SEED_NOW=${seedNow().toISOString()}`);
  await runProfile(profile, stats);
  console.log(`[seed] 완료 (profile=${profile})`);
  console.log(stats.report());
}

// require.main === module: CLI로 직접 실행될 때만 시드를 돌린다. 통합 테스트가
// runProfile을 재사용하려고 이 파일을 import할 때는 부수효과(연결 해제 포함)가 없어야 한다.
if (require.main === module) {
  main()
    .catch((error: unknown) => {
      console.error('[seed] 실패:', error);
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
