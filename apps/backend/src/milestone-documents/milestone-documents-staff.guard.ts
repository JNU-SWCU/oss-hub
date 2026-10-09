import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/controller/http-auth';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';

interface MilestoneDocumentsStaffStore {
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

export interface MilestoneDocumentsStaffRequest extends AuthenticatedRequest {
  milestoneDocumentActorId: string;
}

@Injectable()
export class MilestoneDocumentsStaffGuard implements CanActivate {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: MilestoneDocumentsStaffStore,
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
      throw this.staffOnly();
    }

    if (!user.hasStaffAccess && !user.hasAdminAccess) {
      throw this.staffOnly();
    }
    Object.assign(request, { milestoneDocumentActorId: user.id });
    return true;
  }

  private staffOnly(): DomainException {
    return new DomainException(
      MILESTONE_DOCUMENTS_ERROR_CODES[MilestoneDocumentsErrorCode.STAFF_ONLY],
    );
  }
}
