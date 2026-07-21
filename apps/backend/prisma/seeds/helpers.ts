import { AccountStatus, PrismaClient, Role, User } from '@prisma/client';
import { createHash } from 'node:crypto';

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

/** production 실행을 거부한다(#110 완료 조건: "production 환경에서는 실행을 거부한다"). */
export function assertSeedAllowed(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv === 'production') {
    throw new Error(
      '시드는 production 환경에서 실행할 수 없습니다 (NODE_ENV=production).',
    );
  }
}

export type SeedProfile =
  'auth' | 'intake' | 'milestones' | 'repositories' | 'all';

const SEED_PROFILES: readonly SeedProfile[] = [
  'auth',
  'intake',
  'milestones',
  'repositories',
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

/** RFC 2606 예약 도메인 — 실제 GitHub repository로 연결되지 않는 명백한 fixture URL. */
export function seedFixtureUrl(slug: string): string {
  return `https://github.invalid/oss-hub-seed/${slug}`;
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
        update: { login, role, accountStatus },
        create: { id, githubId, login, role, accountStatus },
      }),
  );
}
