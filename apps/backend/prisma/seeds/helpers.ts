import { AccountStatus, PrismaClient, Role, User } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CONSENT_POLICY_VERSION } from '../../src/consents/domain/consent-policy';
import { isValidUserName } from '../../src/users/user-profile-policy';

/**
 * #110 시드 전용 Prisma 클라이언트. Nest DI 라이프사이클(OnModuleInit 등) 밖에서
 * `prisma db seed`가 단독 스크립트로 실행하므로 PrismaService 대신 원시 클라이언트를 쓴다.
 */
export const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

function parseSeedNow(raw: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`SEED_NOW는 유효한 ISO 날짜여야 합니다: "${raw}"`);
  }
  return parsed;
}

/** SEED_NOW를 프로세스 시작 시점에 한 번만 고정한다 — 같은 실행 내 모든 D-day 계산이 같은 기준을 쓴다. */
const SEED_NOW: Date = process.env.SEED_NOW
  ? parseSeedNow(process.env.SEED_NOW)
  : new Date();

export function seedNow(): Date {
  return SEED_NOW;
}

/** SEED_NOW 기준 상대 일수. 양수는 미래, 음수는 과거(지난 마감 등)를 만든다. */
export function offsetDays(days: number): Date {
  return new Date(SEED_NOW.getTime() + days * DAY_MS);
}

/**
 * production 실행을 거부한다(#110 완료 조건: "production 환경에서는 실행을 거부한다").
 *
 * `demo` profile만 예외다 — 소유자 승인(@GoBeromsu, qa-econovation-batch TODO 11 플랜) 하에
 * `SEED_DEMO_ALLOW_PRODUCTION=1`을 명시했을 때만 production에서도 실행을 허용한다
 * (`prisma/AGENTS.md`·`prisma/README.md`에 문서화된 시드 규칙 개정). 다른 모든 profile은
 * 이 예외의 영향을 받지 않는다 — `profile`을 넘기지 않는 호출은 계속 무조건 거부한다.
 */
export function assertSeedAllowed(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  profile?: SeedProfile,
  demoAllowProductionFlag: string | undefined = process.env
    .SEED_DEMO_ALLOW_PRODUCTION,
): void {
  if (nodeEnv !== 'production') {
    return;
  }
  if (profile === 'demo' && demoAllowProductionFlag === '1') {
    return;
  }
  throw new Error(
    '시드는 production 환경에서 실행할 수 없습니다 (NODE_ENV=production). ' +
      'demo profile은 SEED_DEMO_ALLOW_PRODUCTION=1을 명시했을 때만 예외로 허용됩니다.',
  );
}

const OSS_HUB_ALLOWED_NODE_ENVS: readonly string[] = [
  'development',
  'test',
  'staging',
  'preview',
];
const OSS_HUB_SEED_CONFIRMATION = 'NON_PRODUCTION';

export function assertOssHubSeedAllowed(
  nodeEnv: string | undefined,
  confirmation: string | undefined,
): void {
  if (!nodeEnv || !OSS_HUB_ALLOWED_NODE_ENVS.includes(nodeEnv)) {
    throw new Error(
      `oss-hub 시드는 명시적인 비운영 NODE_ENV에서만 실행할 수 있습니다 (${OSS_HUB_ALLOWED_NODE_ENVS.join(', ')}).`,
    );
  }
  if (confirmation !== OSS_HUB_SEED_CONFIRMATION) {
    throw new Error(
      'oss-hub 시드는 OSS_HUB_SEED_CONFIRMATION=NON_PRODUCTION 확인값이 필요합니다.',
    );
  }
}

export type SeedProfile =
  | 'auth'
  | 'intake'
  | 'milestones'
  | 'repositories'
  | 'program-overview'
  | 'oss-hub'
  | 'demo'
  | 'all';

const SEED_PROFILES: readonly SeedProfile[] = [
  'auth',
  'intake',
  'milestones',
  'repositories',
  'program-overview',
  'oss-hub',
  'demo',
  'all',
];

/** 안전한 최소 profile — CI·`prisma migrate reset` 자동 시드 훅의 기본값이다. */
export const DEFAULT_SEED_PROFILE: SeedProfile = 'auth';

function isSeedProfile(value: string): value is SeedProfile {
  return (SEED_PROFILES as readonly string[]).includes(value);
}

/**
 * profile 결정 순서: CLI `--profile <name>`(예: `pnpm --filter backend prisma db seed -- --profile auth`) →
 * `SEED_PROFILE` env(인자를 못 넘기는 `migrate reset` 자동 훅용) → 기본값(안전한 최소 profile).
 */
export function resolveSeedProfile(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): SeedProfile {
  const flagIndex = argv.indexOf('--profile');
  const fromArgv = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  const candidate = fromArgv ?? env.SEED_PROFILE ?? DEFAULT_SEED_PROFILE;
  if (!isSeedProfile(candidate)) {
    throw new Error(
      `알 수 없는 SEED_PROFILE "${candidate}" — 허용값: ${SEED_PROFILES.join(', ')}`,
    );
  }
  return candidate;
}

/**
 * `--teardown` CLI 플래그(qa-econovation-batch TODO 15) — 지금은 `demo` profile만 지원한다.
 * 이 플래그가 있으면 `seed.ts`가 시드를 만드는 대신 그 profile이 만든 `seed:<profile>:*`
 * 행을 전부 삭제한다. env 대응은 두지 않는다 — teardown은 항상 명시적 CLI 인자로만 트리거한다.
 */
export function resolveTeardownFlag(
  argv: readonly string[] = process.argv,
): boolean {
  return argv.includes('--teardown');
}

export type OssHubTeamAccount = {
  githubId: bigint;
  login: string;
  role: 'ADMIN';
  /**
   * 배포 환경에서만 주입되는 실제 표시 이름(랭킹·팀 화면용). tracked 파일에는 절대
   * 하드코딩하지 않는다 — 이 필드는 항상 `OSS_HUB_TEAM_ACCOUNTS` env의 4번째 세그먼트에서만 온다.
   */
  displayName?: string;
};

const OSS_HUB_TEAM_ACCOUNT_COUNT = 4;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const OSS_HUB_TEAM_ACCOUNTS_ERROR =
  'OSS_HUB_TEAM_ACCOUNTS는 githubId:login:ADMIN[:displayName] 형식의 서로 다른 4개 항목이어야 합니다.';

export function parseOssHubTeamAccounts(
  raw: string | undefined,
): readonly OssHubTeamAccount[] {
  const entries = raw?.split(',') ?? [];
  if (entries.length !== OSS_HUB_TEAM_ACCOUNT_COUNT) {
    throw new Error(OSS_HUB_TEAM_ACCOUNTS_ERROR);
  }

  const githubIds = new Set<string>();
  const logins = new Set<string>();
  const accounts = entries.map((entry): OssHubTeamAccount => {
    const parts = entry.split(':');
    if (parts.length !== 3 && parts.length !== 4) {
      throw new Error(OSS_HUB_TEAM_ACCOUNTS_ERROR);
    }

    const [githubIdRaw, login, role, displayName] = parts;
    if (
      !githubIdRaw ||
      !/^[0-9]+$/.test(githubIdRaw) ||
      !login ||
      !GITHUB_LOGIN_PATTERN.test(login) ||
      role !== Role.ADMIN ||
      (displayName !== undefined && !isValidUserName(displayName))
    ) {
      throw new Error(OSS_HUB_TEAM_ACCOUNTS_ERROR);
    }

    const githubId = BigInt(githubIdRaw);
    const normalizedGithubId = githubId.toString();
    const normalizedLogin = login.toLowerCase();
    if (
      githubId <= 0n ||
      githubId > POSTGRES_BIGINT_MAX ||
      githubIds.has(normalizedGithubId) ||
      logins.has(normalizedLogin)
    ) {
      throw new Error(OSS_HUB_TEAM_ACCOUNTS_ERROR);
    }

    githubIds.add(normalizedGithubId);
    logins.add(normalizedLogin);
    return {
      githubId,
      login,
      role: Role.ADMIN,
      ...(displayName !== undefined ? { displayName } : {}),
    };
  });

  return accounts.sort((left, right) =>
    left.githubId < right.githubId
      ? -1
      : left.githubId > right.githubId
        ? 1
        : 0,
  );
}

/** id·자연키에 쓰는 결정적 slug. 같은 인자는 항상 같은 문자열을 만든다(멱등 upsert 키). */
export function seedId(...parts: readonly string[]): string {
  return ['seed', ...parts].join(':');
}

const SEED_GITHUB_ID_PREFIX = 9_600_000_000_000_000n;
const SEED_REPOSITORY_ID_PREFIX = 9_700_000_000_000_000n;
const SEED_ID_MODULUS = 1_000_000_000_000n;

function deterministicBigInt(prefix: bigint, slug: string): bigint {
  const digest = createHash('sha256').update(slug).digest();
  const value = digest.readBigUInt64BE(0) % SEED_ID_MODULUS;
  return prefix + value;
}

/** 실제 GitHub numeric user id와 겹치지 않는 고정 대역(9.6*10^15~)의 합성 githubId. */
export function seedGithubId(slug: string): bigint {
  return deterministicBigInt(SEED_GITHUB_ID_PREFIX, slug);
}

/** 실제 GitHub repository id와 겹치지 않는 고정 대역(9.7*10^15~)의 합성 id. */
export function seedRepositoryId(slug: string): bigint {
  return deterministicBigInt(SEED_REPOSITORY_ID_PREFIX, slug);
}

/**
 * 합성 fixture nameWithOwner — `oss-hub-seed`는 실존 GitHub owner가 아닌 명백한 시드
 * 네임스페이스다. #617 단계 D 이후 GithubRepository는 name/url 컬럼이 없고 nameWithOwner에서
 * 파생하므로(`repository-identity.ts`), url을 별도로 위장할 수단이 없다 — 대신 owner 자체를
 * 합성값으로 고정해 실존 대상을 가리키지 않게 한다. githubRepositoryId는 seedRepositoryId()의
 * 예약 대역을 쓰므로, 이 값과 짝지으면 "실존 대상 + 합성 식별자" 혼합(반쪽짜리 실제 데이터,
 * `AGENTS.md` antipattern #2)이 되지 않는다.
 */
export function seedNameWithOwner(slug: string): string {
  return `oss-hub-seed/${slug}`;
}

type Bucket = { created: number; updated: number };

/** 시드 실행 로그: 모델별 생성/갱신 카운트 + DB에 쓰지 않는 fixture-only scenario 목록. */
export class SeedStats {
  private readonly buckets = new Map<string, Bucket>();
  private readonly fixtureOnly: string[] = [];

  private bucket(model: string): Bucket {
    const existing = this.buckets.get(model);
    if (existing) return existing;
    const created: Bucket = { created: 0, updated: 0 };
    this.buckets.set(model, created);
    return created;
  }

  created(model: string): void {
    this.bucket(model).created += 1;
  }

  updated(model: string): void {
    this.bucket(model).updated += 1;
  }

  /** DB row를 만들지 않는 scenario(application-validation-error, empty-programs 등)를 기록한다. */
  noteFixtureOnly(scenarioId: string): void {
    this.fixtureOnly.push(scenarioId);
  }

  report(): string {
    const lines = [...this.buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([model, { created, updated }]) =>
          `  ${model}: created=${created} updated=${updated}`,
      );
    const fixtureLine =
      this.fixtureOnly.length > 0
        ? [`  fixture-only (DB 미기록): ${this.fixtureOnly.join(', ')}`]
        : [];
    return [...lines, ...fixtureLine].join('\n');
  }
}

/**
 * find→upsert를 한 번에 묶어 created/updated를 집계한다. find는 upsert의 where 절과
 * 동일한 unique key로 존재 여부만 확인한다.
 */
export async function upsertTracked<T>(
  stats: SeedStats,
  model: string,
  find: () => Promise<unknown>,
  upsert: () => Promise<T>,
): Promise<T> {
  const existing = await find();
  const result = await upsert();
  if (existing) {
    stats.updated(model);
  } else {
    stats.created(model);
  }
  return result;
}

/** 여러 도메인 시드 파일이 공유하는 User upsert. login은 id에서 파생한 고정 값이다. */
export async function upsertSeedUser(
  stats: SeedStats,
  params: {
    id: string;
    role: Role | null;
    accountStatus?: AccountStatus;
  },
): Promise<User> {
  const { id, role, accountStatus = AccountStatus.ACTIVE } = params;
  const login = id.replace(/^seed:/, 'seed-').replace(/:/g, '-');
  const githubId = seedGithubId(id);
  return upsertTracked(
    stats,
    'User',
    () => prisma.user.findUnique({ where: { id } }),
    () =>
      prisma.user.upsert({
        where: { id },
        update: { nickname: login, role, accountStatus },
        create: { id, githubId, nickname: login, role, accountStatus },
      }),
  );
}

/** 여러 도메인 시드 파일이 공유하는 Consent upsert. 정책 버전은 현행 고정값 하나다. */
export async function upsertConsent(
  stats: SeedStats,
  userId: string,
): Promise<void> {
  await upsertTracked(
    stats,
    'Consent',
    () =>
      prisma.consent.findUnique({
        where: {
          userId_policyVersion: {
            userId,
            policyVersion: CONSENT_POLICY_VERSION,
          },
        },
      }),
    () =>
      prisma.consent.upsert({
        where: {
          userId_policyVersion: {
            userId,
            policyVersion: CONSENT_POLICY_VERSION,
          },
        },
        update: {},
        create: { userId, policyVersion: CONSENT_POLICY_VERSION },
      }),
  );
}
