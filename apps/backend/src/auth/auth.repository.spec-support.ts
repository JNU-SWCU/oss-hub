import { AuthConfig } from '../platform/auth.config';
import { AccountStatus, type Prisma, type User } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import { AuthRepository, type AuthLoginRow } from './auth.repository';
import type { GithubProfile } from './http-auth.types';
export function prismaServiceWith(overrides: object): PrismaService {
  return Object.assign(new PrismaService(), overrides);
}
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
    githubId: 424242n,
    login: 'synthetic-login',
    name: null,
    avatarUrl: null,
    email: null,
    ...overrides,
  };
}

type AuthUserRow = User & {
  readonly admin: { readonly userId: string } | null;
};
export function buildRow(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
  return {
    id: 'cuid-synthetic',
    githubId: 424242n,
    nickname: 'synthetic-login',
    avatarUrl: null,
    phone: null,
    accountStatus: AccountStatus.ACTIVE,
    sessionVersion: 0,
    type: 'UNSELECTED',
    name: null,
    studentId: null,
    staffNumber: null,
    department: null,
    departmentType: null,
    profileCreatedAt: null,
    profileUpdatedAt: null,
    approvalStatus: 'NOT_REQUIRED',
    approvalRequestId: null,
    approvalRequestedAt: null,
    approvalDecidedAt: null,
    approvalDecidedById: null,
    approvalReason: null,
    notificationEmail: null,
    notifyEnabled: true,
    admin: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}
export function buildRepository(
  row: AuthUserRow,
  options: { readonly isNew?: boolean } = {},
) {
  let stored = row;
  const createMany = jest
    .fn()
    .mockResolvedValue({ count: options.isNew ? 1 : 0 });
  const findUniqueOrThrow = jest
    .fn()
    .mockImplementation(() => Promise.resolve(stored));
  const update = jest
    .fn()
    .mockImplementation((input: { data: Prisma.UserUpdateInput }) => {
      stored = {
        ...stored,
        ...(typeof input.data.nickname === 'string'
          ? { nickname: input.data.nickname }
          : {}),
        ...(input.data.avatarUrl === null ||
        typeof input.data.avatarUrl === 'string'
          ? { avatarUrl: input.data.avatarUrl }
          : {}),
        ...(typeof input.data.notificationEmail === 'string'
          ? { notificationEmail: input.data.notificationEmail }
          : {}),
        ...(typeof input.data.approvalStatus === 'string'
          ? { approvalStatus: input.data.approvalStatus }
          : {}),
      };
      return Promise.resolve(stored);
    });
  const adminCreate = jest.fn().mockImplementation(() => {
    stored = { ...stored, admin: { userId: stored.id } };
    return Promise.resolve(stored.admin);
  });
  const historyCreate = jest.fn().mockResolvedValue({});
  const prisma = prismaServiceWith({
    user: { createMany, findUniqueOrThrow, update },
    admin: { create: adminCreate },
    userHistory: { create: historyCreate },
  });
  Object.assign(prisma, {
    $transaction: <T>(operation: (transaction: PrismaService) => Promise<T>) =>
      operation(prisma),
  });
  return {
    repository: new AuthRepository(prisma),
    createMany,
    update,
    adminCreate,
    historyCreate,
  };
}
export function upsertUser(
  repository: AuthRepository,
  profile: GithubProfile,
): Promise<AuthLoginRow> {
  return repository.withTransaction((store) => store.upsertUser(profile));
}
