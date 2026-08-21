import { AccountStatus, Role } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthUser } from './domain/auth-user';
import { LoginHistoryService } from '../login-history/login-history.service';

export const syntheticUser: AuthUser = {
  id: 'synthetic-id',
  githubId: 424242n,
  nickname: 'synthetic-login',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  role: null,
  memberKind: null,
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: false,
};

export const syntheticOnboardedUser: AuthUser = {
  ...syntheticUser,
  role: Role.STUDENT,
  isProfileComplete: true,
};

export const recordLogin = jest.fn();

export function createResponse(): Response & {
  setHeader: jest.Mock;
  redirect: jest.Mock;
} {
  return {
    setHeader: jest.fn(),
    redirect: jest.fn(),
  } as unknown as Response & { setHeader: jest.Mock; redirect: jest.Mock };
}

export function createController(
  serviceOverrides: Partial<AuthService> = {},
): AuthController {
  const service = {
    completeLogin: jest
      .fn()
      .mockResolvedValue({ user: syntheticOnboardedUser, isNew: false }),
    issueSession: jest.fn().mockResolvedValue('synthetic-session'),
    ...serviceOverrides,
  } as unknown as AuthService;
  const config = {
    frontendUrl: 'https://oss.example',
    useSecureCookies: true,
  } as AuthConfig;
  return new AuthController(service, config, {
    recordLogin,
  } as unknown as LoginHistoryService);
}

export function requestWithCookie(cookie?: string): Request {
  return {
    headers: { cookie },
    path: '/api/v1/auth/github/callback',
  } as Request;
}
