import {
  AccountStatus,
  Role,
  RoleRequestStatus,
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

export function buildRow(overrides: Partial<PrismaUser> = {}): PrismaUser {
  return {
    id: 'cuid-synthetic',
    githubId: 424_242n,
    nickname: 'synthetic-login',
    name: null,
    studentId: null,
    department: null,
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    role: null,
    selectedRole: null,
    selectedMemberKind: null,
    hasStaffAccess: null,
    hasAdminAccess: null,
    notificationEmail: null,
    notifyEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function buildRepository(
  row: PrismaUser,
  initialRole: Role | null,
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
    [{ where: { status?: RoleRequestStatus } }]
  >();
  findFirst.mockImplementation((args) =>
    Promise.resolve(
      args.where.status === RoleRequestStatus.REVOKED
        ? (options.revokedRequest ?? null)
        : (options.pendingRequest ?? null),
    ),
  );
  const roleRequestUpdate = jest.fn().mockResolvedValue({});
  const roleRequestUpdateMany = jest.fn<
    Promise<{ count: number }>,
    [{ where: Record<string, unknown> }]
  >();
  roleRequestUpdateMany.mockResolvedValue({
    count: options.pendingTransitionCount ?? 1,
  });
  const roleRequestCreate = jest.fn<
    Promise<unknown>,
    [{ data: Record<string, unknown> }]
  >();
  roleRequestCreate.mockResolvedValue({});
  const transaction = {
    user: { createMany, findUniqueOrThrow, update, updateMany },
    roleRequest: {
      findFirst,
      update: roleRequestUpdate,
      updateMany: roleRequestUpdateMany,
      create: roleRequestCreate,
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
    roleRequestUpdate,
    roleRequestUpdateMany,
    roleRequestCreate,
  };
}

export function upsertUser(repository: AuthRepository, profile: GithubProfile) {
  return repository.withTransaction((store) => store.upsertUser(profile));
}
