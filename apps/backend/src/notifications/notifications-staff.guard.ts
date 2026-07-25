import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.enum';

interface NotificationsStaffStore {
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

@Injectable()
export class NotificationsStaffGuard implements CanActivate {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: NotificationsStaffStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.prisma.user.findUnique({
      where: { githubId: request.sessionGithubId },
      select: { id: true, role: true, accountStatus: true },
    });

    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.STAFF_ONLY],
      );
    }

    switch (user.role) {
      case Role.STAFF:
      case Role.ADMIN:
        return true;
      case Role.STUDENT:
      case null:
      case undefined:
        throw new DomainException(
          NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.STAFF_ONLY],
        );
    }
  }
}
