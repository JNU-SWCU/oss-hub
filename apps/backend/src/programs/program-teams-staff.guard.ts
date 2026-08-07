import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { TEAMS_ERROR_CODES, TeamsErrorCode } from './teams-error-code.enum';

interface ProgramTeamsStaffStore {
  readonly user: {
    findUnique(input: {
      readonly where: { readonly githubId: bigint };
      readonly select: {
        readonly id: true;
        readonly role: true;
        readonly accountStatus: true;
      };
    }): Promise<{
      readonly id: string;
      readonly role: Role | null;
      readonly accountStatus: AccountStatus;
    } | null>;
  };
}

export interface ProgramTeamsStaffRequest extends AuthenticatedRequest {
  programTeamsActorId: string;
}

/**
 * 교직원 전용 팀 목록(GET /programs/:programId/teams) 앞단 가드.
 * ACTIVE + STAFF/ADMIN 만 통과하고 그 밖에는 `TEAM_003`(403)로 거부한다.
 *
 * `applications/applications-staff.guard.ts`를 본떴지만 그 가드를 import 하지 않는다 —
 * 이 저장소는 모듈마다 자기 staff 가드를 두고, 모듈 간 직접 참조는
 * `common/architecture-boundary.eslint.spec.ts`가 고정하는 경계 규칙 대상이다.
 */
@Injectable()
export class ProgramTeamsStaffGuard implements CanActivate {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: ProgramTeamsStaffStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.prisma.user.findUnique({
      where: { githubId: request.sessionGithubId },
      select: { id: true, role: true, accountStatus: true },
    });

    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      throw this.forbidden();
    }

    switch (user.role) {
      case Role.STAFF:
      case Role.ADMIN:
        Object.assign(request, { programTeamsActorId: user.id });
        return true;
      case Role.STUDENT:
      case null:
      case undefined:
        throw this.forbidden();
    }
  }

  private forbidden(): DomainException {
    return new DomainException(TEAMS_ERROR_CODES[TeamsErrorCode.STAFF_ONLY]);
  }
}
