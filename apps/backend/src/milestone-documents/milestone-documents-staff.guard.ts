import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/session.guard';
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

export interface MilestoneDocumentsStaffRequest extends AuthenticatedRequest {
  milestoneDocumentActorId: string;
}

/** 서류 항목 CRUD·양식 업로드·집계 조회 등 교직원 전용 endpoint 앞단에 붙인다. */
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
      select: { id: true, role: true, accountStatus: true },
    });

    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      throw this.staffOnly();
    }

    switch (user.role) {
      case Role.STAFF:
      case Role.ADMIN:
        Object.assign(request, { milestoneDocumentActorId: user.id });
        return true;
      case Role.STUDENT:
      case null:
      case undefined:
        throw this.staffOnly();
    }
  }

  private staffOnly(): DomainException {
    return new DomainException(
      MILESTONE_DOCUMENTS_ERROR_CODES[MilestoneDocumentsErrorCode.STAFF_ONLY],
    );
  }
}
