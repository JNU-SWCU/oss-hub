import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus, Prisma, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException, type ErrorCode } from '../common/error-code';
import { resolveMemberAccess } from '../profiles/member-authority-compatibility';
import { PrismaService } from '../prisma/prisma.service';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';

/** 권한 판단은 canonical 컬럼이 정본이다. `role`은 backfill 전 행의 fallback으로만 읽는다. */
const APPLICATIONS_STAFF_SELECT = {
  id: true,
  role: true,
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
      readonly role: Role | null;
      readonly hasStaffAccess: boolean | null;
      readonly hasAdminAccess: boolean | null;
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
      select: APPLICATIONS_STAFF_SELECT,
    });

    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(this.staffForbiddenError());
    }

    const access = resolveMemberAccess(user);
    if (!access.hasStaffAccess && !access.hasAdminAccess) {
      throw new DomainException(this.staffForbiddenError());
    }

    Object.assign(request, { applicationActorId: user.id });
    return true;
  }
}

/** 신청자 목록 등 조회용 — generic 403 (판정-only 문구 금지). */
@Injectable()
export class ApplicationsStaffListGuard extends ApplicationsStaffGuard {
  protected override staffForbiddenError(): ErrorCode {
    return APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_LIST_ONLY];
  }
}
