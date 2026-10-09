import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/controller/http-auth';
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
