import type { InitialAccountSeed } from './initial-roles';
import {
  AccountStatus,
  StaffAccessRequestStatus,
  MemberKind,
  User as PrismaUser,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { AuthConfig } from './auth.config';
import { AuthRepository } from './auth.repository';

export function prismaServiceWith(overrides: object): PrismaService {
  return Object.assign(new PrismaService(), overrides);
}
import type { GithubProfile } from './domain/auth-user';
const REQUIRED_AUTH_ENV = {
  SESSION_SECRET: Buffer.from(
    'synthetic-auth-repository-session-secret',
  ).toString('base64url'),
  FRONTEND_URL: 'http://localhost:3000',
  GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
  GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
} as const;

export function buildAuthConfig(overrides: NodeJS.ProcessEnv = {}): AuthConfig {
  return new AuthConfig(
    loadRuntimeConfig({ ...REQUIRED_AUTH_ENV, ...overrides }),
  );
}

export function buildProfile(
  overrides: Partial<GithubProfile> = {},
): GithubProfile {
  return {
    githubId: 424_242n,
    login: 'synthetic-login',
    name: null,
    avatarUrl: null,
    email: null,
    ...overrides,
  };
}

type AuthUserRow = PrismaUser & {
  readonly profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
    readonly memberKind: MemberKind;
  } | null;
};

export function buildRow(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
  return {
    id: 'cuid-synthetic',
    githubId: 424_242n,
    nickname: 'synthetic-login',
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    selectedMemberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    notificationEmail: null,
    notifyEnabled: true,
    // 프로필 행이 없다는 것이 곧 "아직 가입을 마치지 않았다"는 뜻이다 —
    // 초기 시드는 그 상태에서만 적용된다(`hasSeededAuthority`).
    profile: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function buildRepository(
  row: AuthUserRow,
  initialRole: InitialAccountSeed | null,
  options: {
    isNew?: boolean;
    casCount?: number;
    pendingRequest?: { id: string } | null;
    revokedRequest?: { id: string } | null;
    pendingTransitionCount?: number;
  } = {},
) {
  const createMany = jest
    .fn()
    .mockResolvedValue({ count: options.isNew ? 1 : 0 });
  const findUniqueOrThrow = jest.fn().mockResolvedValue(row);
  const update = jest.fn().mockResolvedValue(row);
  const updateMany = jest.fn<
    Promise<{ count: number }>,
    [{ where: Record<string, unknown>; data: Record<string, unknown> }]
  >();
  updateMany.mockResolvedValue({ count: options.casCount ?? 1 });
  // 같은 findFirst가 두 가지를 조회한다 — 시드가 전이할 PENDING 신청과,
  // 시드가 적용되지 않은 이유를 가르는 REVOKED 이력이다. status로 갈라 준다.
  const findFirst = jest.fn<
    Promise<{ id: string } | null>,
    [{ where: { status?: StaffAccessRequestStatus } }]
  >();
  findFirst.mockImplementation((args) =>
    Promise.resolve(
      args.where.status === StaffAccessRequestStatus.REVOKED
        ? (options.revokedRequest ?? null)
        : (options.pendingRequest ?? null),
    ),
  );
  const staffAccessRequestUpdate = jest.fn().mockResolvedValue({});
  const staffAccessRequestUpdateMany = jest.fn<
    Promise<{ count: number }>,
    [{ where: Record<string, unknown> }]
  >();
  staffAccessRequestUpdateMany.mockResolvedValue({
    count: options.pendingTransitionCount ?? 1,
  });
  const staffAccessRequestCreate = jest.fn<
    Promise<unknown>,
    [{ data: Record<string, unknown> }]
  >();
  staffAccessRequestCreate.mockResolvedValue({});
  const transaction = {
    user: { createMany, findUniqueOrThrow, update, updateMany },
    staffAccessRequest: {
      findFirst,
      update: staffAccessRequestUpdate,
      updateMany: staffAccessRequestUpdateMany,
      create: staffAccessRequestCreate,
    },
  };
  const $transaction = jest
    .fn()
    .mockImplementation(
      (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
  const prisma = prismaServiceWith({ $transaction });
  const config = buildAuthConfig();
  jest.spyOn(config, 'resolveInitialRole').mockReturnValue(initialRole);
  return {
    repository: new AuthRepository(prisma, config),
    createMany,
    update,
    updateMany,
    findFirst,
    staffAccessRequestUpdate,
    staffAccessRequestUpdateMany,
    staffAccessRequestCreate,
  };
}

export function upsertUser(repository: AuthRepository, profile: GithubProfile) {
  return repository.withTransaction((store) => store.upsertUser(profile));
}
