import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';

import { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from './collection-error-code.enum';

/** 권한 판단은 canonical 컬럼만 읽는다. */
const COLLECTION_ADMIN_SELECT = {
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
} as const satisfies Prisma.UserSelect;

@Injectable()
export class CollectionAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.prisma.user.findUnique({
      where: { githubId: request.sessionGithubId },
      select: COLLECTION_ADMIN_SELECT,
    });
    if (user?.accountStatus !== AccountStatus.ACTIVE || !user.hasAdminAccess) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.ADMIN_REQUIRED],
      );
    }
    return true;
  }
}
