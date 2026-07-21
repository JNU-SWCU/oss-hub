import { Injectable } from '@nestjs/common';
import { RoleRequestStatus } from '@prisma/client';
import type { Role } from '@prisma/client';
import type { Request } from 'express';
import { AuthConfig } from '../auth/auth.config';
import { parseCookies, sessionCookieName } from '../auth/cookies';
import { verifySessionToken } from '../auth/session-token';
import { PrismaService } from '../prisma/prisma.service';
import type { ProgramViewerRole } from './dto/program-detail.dto';

export interface ProgramViewer {
  readonly githubId: bigint | null;
  readonly userId: string | null;
  readonly role: ProgramViewerRole;
}

@Injectable()
export class ProgramViewerService {
  constructor(
    private readonly config: AuthConfig,
    private readonly prisma: PrismaService,
  ) {}

  async fromRequest(request: Request): Promise<ProgramViewer> {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[sessionCookieName(this.config.useSecureCookies)];
    const githubId = token
      ? await verifySessionToken(this.config.sessionSecret, token)
      : null;
    if (githubId === null) return { githubId: null, userId: null, role: null };

    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        role: true,
        roleRequests: {
          where: { status: RoleRequestStatus.PENDING },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!user) return { githubId, userId: null, role: null };

    const role: Role | 'PENDING' | null =
      user.role ?? (user.roleRequests.length > 0 ? 'PENDING' : null);
    return { githubId, userId: user.id, role };
  }
}
