import { createHash } from 'node:crypto';
import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  PrismaClient,
  User,
} from '@prisma/client';

export type SeedRole = 'STUDENT' | 'STAFF' | 'ADMIN';

export const SEED_ROLE_FACTS: Record<
  SeedRole,
  {
    readonly memberKind: MemberKind | null;
    readonly hasStaffAccess: boolean;
    readonly hasAdminAccess: boolean;
  }
> = {
  STUDENT: {
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
  },
  STAFF: {
    memberKind: MemberKind.STAFF,
    hasStaffAccess: true,
    hasAdminAccess: false,
  },

  ADMIN: {
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: true,
  },
};
import { CONSENT_POLICY_VERSION } from '../../src/consents/domain/consent-policy';
import { isValidUserName } from '../../src/users/domain/user-profile-policy';

export const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

function parseSeedNow(raw: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`SEED_NOW는 유효한 ISO 날짜여야 합니다: "${raw}"`);
  }
  return parsed;
}

const SEED_NOW: Date = process.env.SEED_NOW
  ? parseSeedNow(process.env.SEED_NOW)
  : new Date();

export function seedNow(): Date {
  return SEED_NOW;
}

export function offsetDays(days: number): Date {
  return new Date(SEED_NOW.getTime() + days * DAY_MS);
}

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

export const DEFAULT_SEED_PROFILE: SeedProfile = 'auth';

function isSeedProfile(value: string): value is SeedProfile {
  return (SEED_PROFILES as readonly string[]).includes(value);
}

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

export function resolveTeardownFlag(
  argv: readonly string[] = process.argv,
): boolean {
  return argv.includes('--teardown');
}

export type OssHubTeamAccount = {
  githubId: bigint;
  login: string;
  role: 'ADMIN';

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
      role !== 'ADMIN' ||
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
      role: 'ADMIN',
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

export function seedGithubId(slug: string): bigint {
  return deterministicBigInt(SEED_GITHUB_ID_PREFIX, slug);
}

export function seedRepositoryId(slug: string): bigint {
  return deterministicBigInt(SEED_REPOSITORY_ID_PREFIX, slug);
}

export function seedNameWithOwner(slug: string): string {
  return `oss-hub-seed/${slug}`;
}

type Bucket = { created: number; updated: number };

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

export async function upsertSeedUser(
  stats: SeedStats,
  params: {
    id: string;
    role: SeedRole | null;
    accountStatus?: AccountStatus;
  },
): Promise<User> {
  const { id, role, accountStatus = AccountStatus.ACTIVE } = params;
  const facts =
    role === null
      ? { memberKind: null, hasStaffAccess: false, hasAdminAccess: false }
      : SEED_ROLE_FACTS[role];
  const login = id.replace(/^seed:/, 'seed-').replace(/:/g, '-');
  const githubId = seedGithubId(id);
  return upsertTracked(
    stats,
    'User',
    () => prisma.user.findUnique({ where: { id } }),
    () =>
      prisma.user.upsert({
        where: { id },
        update: {
          nickname: login,
          accountStatus,
          selectedMemberKind: facts.memberKind,
          hasStaffAccess: facts.hasStaffAccess,
          hasAdminAccess: facts.hasAdminAccess,
        },
        create: {
          id,
          githubId,
          nickname: login,
          accountStatus,
          selectedMemberKind: facts.memberKind,
          hasStaffAccess: facts.hasStaffAccess,
          hasAdminAccess: facts.hasAdminAccess,
        },
      }),
  );
}

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

export async function upsertSeedProfile(params: {
  readonly userId: string;
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly affiliationKind?: AffiliationKind;
}): Promise<void> {
  const affiliationKind =
    params.affiliationKind ??
    (params.memberKind === MemberKind.STUDENT
      ? AffiliationKind.DEPARTMENT
      : AffiliationKind.PROGRAM_OFFICE);
  const write = {
    name: params.name,
    studentId: params.studentId,
    department: params.department,
    memberKind: params.memberKind,
    affiliationKind,
    affiliationName: params.department,
  };
  await prisma.userProfile.upsert({
    where: { userId: params.userId },
    update: write,
    create: { userId: params.userId, ...write },
  });
}
