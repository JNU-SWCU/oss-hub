import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException, type ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';

const APPLICATIONS_STAFF_SELECT = {
  id: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
} as const satisfies Prisma.UserSelect;

interface ApplicationsStaffStore {
  readonly user: {
    findUnique(input: {
      readonly where: { readonly githubId: bigint };
      readonly select: typeof APPLICATIONS_STAFF_SELECT;
    }): Promise<{
      readonly id: string;
      readonly hasStaffAccess: boolean;
      readonly hasAdminAccess: boolean;
      readonly accountStatus: AccountStatus;
    } | null>;
  };
}

export interface ApplicationStaffRequest extends AuthenticatedRequest {
  applicationActorId: string;
}

@Injectable()
export class ApplicationsStaffGuard implements CanActivate {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: ApplicationsStaffStore,
  ) {}

  protected staffForbiddenError(): ErrorCode {
    return APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_ONLY];
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.prisma.user.findUnique({
      where: { githubId: request.sessionGithubId },
      select: APPLICATIONS_STAFF_SELECT,
    });

    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(this.staffForbiddenError());
    }

    if (!user.hasStaffAccess && !user.hasAdminAccess) {
      throw new DomainException(this.staffForbiddenError());
    }

    Object.assign(request, { applicationActorId: user.id });
    return true;
  }
}

@Injectable()
export class ApplicationsStaffListGuard extends ApplicationsStaffGuard {
  protected override staffForbiddenError(): ErrorCode {
    return APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_LIST_ONLY];
  }
}
