import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
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
        readonly hasStaffAccess: true;
        readonly hasAdminAccess: true;
        readonly accountStatus: true;
      };
    }): Promise<{
      readonly id: string;
      readonly hasStaffAccess: boolean;
      readonly hasAdminAccess: boolean;
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
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });

    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      throw this.forbidden();
    }

    // 교직원 접근과 관리자 접근은 서로 독립이다 — 어느 한쪽만 있어도 이 문을 지난다.
    // 관리자가 곧 교직원은 아니지만, 이 화면은 두 권한 모두에게 열려 있던 자리다.
    if (!user.hasStaffAccess && !user.hasAdminAccess) {
      throw this.forbidden();
    }
    Object.assign(request, { programTeamsActorId: user.id });
    return true;
  }

  private forbidden(): DomainException {
    return new DomainException(TEAMS_ERROR_CODES[TeamsErrorCode.STAFF_ONLY]);
  }
}
