import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException, type ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';

interface ApplicationsStaffStore {
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

export interface ApplicationStaffRequest extends AuthenticatedRequest {
  applicationActorId: string;
}

@Injectable()
export class ApplicationsStaffGuard implements CanActivate {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: ApplicationsStaffStore,
  ) {}

  /** PATCH decide 전용 — 판정 문구 유지. 목록은 ApplicationsStaffListGuard. */
  protected staffForbiddenError(): ErrorCode {
    return APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_ONLY];
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.prisma.user.findUnique({
      where: { githubId: request.sessionGithubId },
      select: { id: true, role: true, accountStatus: true },
    });

    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(this.staffForbiddenError());
    }

    switch (user.role) {
      case Role.STAFF:
      case Role.ADMIN:
        Object.assign(request, { applicationActorId: user.id });
        return true;
      case Role.STUDENT:
      case null:
      case undefined:
        throw new DomainException(this.staffForbiddenError());
    }
  }
}

/** 신청자 목록 등 조회용 — generic 403 (판정-only 문구 금지). */
@Injectable()
export class ApplicationsStaffListGuard extends ApplicationsStaffGuard {
  protected override staffForbiddenError(): ErrorCode {
    return APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_LIST_ONLY];
  }
}
