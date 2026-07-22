import { randomBytes } from 'node:crypto';
import { AccountStatus, Role } from '@prisma/client';
import type { Request } from 'express';
import { AuthConfig } from '../auth/auth.config';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import type { PrismaService } from '../prisma/prisma.service';
import { ProgramViewerService } from './program-viewer.service';

const secret = new Uint8Array(randomBytes(32));
const githubId = 424242n;

function buildConfig(): AuthConfig {
  return {
    useSecureCookies: true,
    sessionSecret: secret,
  } as unknown as AuthConfig;
}

describe('ProgramViewerService', () => {
  it('기존 세션이 있어도 비활성 교직원은 비공개 조회 권한을 얻지 못한다', async () => {
    // Given
    const findUnique = jest.fn().mockResolvedValue({
      id: 'staff-1',
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
      roleRequests: [],
    });
    const prisma = { user: { findUnique } } as unknown as PrismaService;
    const service = new ProgramViewerService(buildConfig(), prisma);
    const token = await issueSessionToken(secret, githubId);
    const request = {
      headers: { cookie: `${sessionCookieName(true)}=${token}` },
    } as Request;

    // When
    const viewer = await service.fromRequest(request);

    // Then
    expect(viewer).toEqual({ githubId, userId: null, role: null });
    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId },
      select: {
        id: true,
        accountStatus: true,
        role: true,
        roleRequests: {
          where: { status: 'PENDING' },
          select: { id: true },
          take: 1,
        },
      },
    });
  });
});
