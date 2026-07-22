import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.prisma.user.findUnique({
      where: { githubId: request.sessionGithubId },
      select: { id: true, role: true, accountStatus: true },
    });

    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_ONLY],
      );
    }

    switch (user.role) {
      case Role.STAFF:
      case Role.ADMIN:
        Object.assign(request, { applicationActorId: user.id });
        return true;
      case Role.STUDENT:
      case null:
      case undefined:
        throw new DomainException(
          APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_ONLY],
        );
    }
  }
}
