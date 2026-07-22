import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  SUBMISSION_REVIEWS_ERROR_CODES,
  SubmissionReviewsErrorCode,
} from './submission-reviews-error-code.enum';

interface SubmissionReviewsStaffStore {
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

export interface SubmissionReviewStaffRequest extends AuthenticatedRequest {
  submissionReviewerId: string;
}

@Injectable()
export class SubmissionReviewsStaffGuard implements CanActivate {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: SubmissionReviewsStaffStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.prisma.user.findUnique({
      where: { githubId: request.sessionGithubId },
      select: { id: true, role: true, accountStatus: true },
    });
    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      throw this.staffApprovalRequired();
    }

    switch (user.role) {
      case Role.STAFF:
      case Role.ADMIN:
        Object.assign(request, { submissionReviewerId: user.id });
        return true;
      case Role.STUDENT:
      case null:
      case undefined:
        throw this.staffApprovalRequired();
    }
  }

  private staffApprovalRequired(): DomainException {
    return new DomainException(
      SUBMISSION_REVIEWS_ERROR_CODES[
        SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED
      ],
    );
  }
}
