import { MemberKindProfileService } from './member-kind-profile.service';
import type { ApprovalStatus } from '@prisma/client';
import { MemberKind } from './user-contract.config';
import { Inject, Injectable } from '@nestjs/common';
import { UserHistoryRepository } from './user-history.repository';
import {
  USER_PROFILE_AUDIT_ACTIONS,
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  INDEPENDENT_AUTHORITY_AUDIT_COMMANDS,
} from '../platform/audit-log-metadata.config';
import { DomainException } from '../platform/error-code.error';
import { SystemErrorCode } from '../platform/system-error-code.error';

import { RolesErrorCode } from './roles-error-code.error';
import {
  MemberKindRepository,
  type MemberKindRepositoryPort,
} from './member-kind.repository';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';
import type { IndependentAuthorityMutationResult } from './independent-authority.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';

export type { MemberKindMutationCommand } from './member-kind-profile.types';
import type { MemberKindMutationCommand } from './member-kind-profile.types';
export type MemberKindMutationResult = IndependentAuthorityMutationResult;

export interface MemberKindPatchRequest {
  readonly memberKind: string;
  readonly expectedMemberKind: string;
  readonly expectedHasStaffAccess: boolean;
  readonly expectedApprovalStatus?: ApprovalStatus;
  readonly expectedApprovalRequestId?: string | null;
  readonly studentId?: string;
  readonly department?: string;
  readonly staffNumber?: string | null;
}

@Injectable()
export class MemberKindService {
  constructor(
    @Inject(MemberKindRepository)
    private readonly repository: MemberKindRepositoryPort,
    @Inject(UserHistoryRepository)
    private readonly auditLog: Pick<UserHistoryRepository, 'record'>,
    private readonly auditLogMetadataService: AuditLogMetadataService,
    private readonly userProfileService: UserProfileService,
    private readonly adminAccessMutationService: AdminAccessMutationService,
    private readonly memberKindProfileService: MemberKindProfileService,
  ) {}

  commandFromRequest(
    request: MemberKindPatchRequest,
  ): MemberKindMutationCommand {
    return {
      memberKind: this.parseRequestedMemberKind(request.memberKind),
      expectedMemberKind: this.parseRequestedMemberKind(
        request.expectedMemberKind,
      ),
      ...this.parseApprovalExpectation(request),
      expectedHasStaffAccess: this.parseExpectedStaffAccess(
        request.expectedHasStaffAccess,
      ),
      ...(request.studentId !== undefined
        ? { studentId: request.studentId }
        : {}),
      ...(request.department !== undefined
        ? { department: request.department }
        : {}),
      ...(request.staffNumber !== undefined
        ? { staffNumber: request.staffNumber }
        : {}),
    };
  }

  private parseApprovalExpectation(
    request: MemberKindPatchRequest,
  ): Pick<
    MemberKindMutationCommand,
    'expectedApprovalStatus' | 'expectedApprovalRequestId'
  > {
    if (
      request.expectedApprovalStatus === undefined &&
      request.expectedApprovalRequestId === undefined
    )
      return {};
    if (
      !['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'REVOKED'].includes(
        request.expectedApprovalStatus ?? '',
      ) ||
      (request.expectedApprovalRequestId !== null &&
        typeof request.expectedApprovalRequestId !== 'string')
    ) {
      throw this.requestValidationError(
        '기대하는 승인 상태와 신청 ID가 필요합니다.',
      );
    }
    return {
      expectedApprovalStatus: request.expectedApprovalStatus,
      expectedApprovalRequestId: request.expectedApprovalRequestId,
    };
  }

  private parseRequestedMemberKind(
    value: string,
  ): MemberKindMutationCommand['memberKind'] {
    switch (value) {
      case MemberKind.STUDENT:
      case MemberKind.STAFF:
        return value;
      default:
        throw this.requestValidationError('지원하지 않는 회원 유형입니다.');
    }
  }

  private parseExpectedStaffAccess(value: boolean): boolean {
    if (typeof value !== 'boolean') {
      throw this.requestValidationError(
        '기대하는 교직원 접근 상태가 올바르지 않습니다.',
      );
    }
    return value;
  }

  private requestValidationError(message: string): DomainException {
    return new DomainException({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
      message,
    });
  }

  patchMemberKindFromRequest(
    actorGithubId: bigint,
    userId: string,
    request: MemberKindPatchRequest,
  ): Promise<MemberKindMutationResult> {
    this.adminAccessMutationService.requireValidUserId(userId);
    return this.patchMemberKind(
      actorGithubId,
      userId,
      this.commandFromRequest(request),
    );
  }

  patchMemberKind(
    actorGithubId: bigint,
    userId: string,
    command: MemberKindMutationCommand,
  ): Promise<MemberKindMutationResult> {
    assertCommandShape(command);
    this.parseApprovalExpectation(command);
    return this.repository.withTransaction(async (store) => {
      await store.lockActiveAdmins();
      const actor = this.adminAccessMutationService.requireActiveAdmin(
        await store.findActorByGithubId(actorGithubId),
      );
      const target = await store.findTargetForUpdate(userId);
      if (!target) {
        throw this.adminAccessMutationService.roleError(
          RolesErrorCode.USER_NOT_FOUND,
        );
      }
      const hasStaffAccess = this.userProfileService.hasStaffAccess({
        ...target,
        profileCreatedAt: target.profileCreatedAt,
        department: target.profile?.department ?? null,
      });
      const before = {
        ...target,
        hasStaffAccess,
        role: this.userProfileService.authorityLabel({
          ...target,
          hasStaffAccess,
        }),
      };
      if (
        !before.profile ||
        !this.userProfileService.isCompleteProfileFields(
          before.profile,
          before.memberKind,
        )
      ) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
        );
      }
      if (
        before.memberKind !== command.expectedMemberKind ||
        before.hasStaffAccess !== command.expectedHasStaffAccess
      ) {
        throw this.adminAccessMutationService.staleAccessError(before);
      }
      const explicitApproval =
        command.expectedApprovalStatus !== undefined &&
        command.expectedApprovalRequestId !== undefined;
      if (
        explicitApproval
          ? before.approvalStatus !== command.expectedApprovalStatus ||
            before.approvalRequestId !== command.expectedApprovalRequestId
          : before.approvalRequestId !== null
      ) {
        throw this.adminAccessMutationService.staleAccessError(before);
      }

      const update = this.memberKindProfileService.resolveMemberKindUpdate(
        before,
        command,
      );
      if (!update.changed) {
        throw this.adminAccessMutationService.staleAccessError(before);
      }
      const outcome = await store.updateMemberKind(
        before,
        actor.id,
        update.profile,
      );
      if (outcome === 'studentIdTaken') {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN],
        );
      }

      if (outcome === 'conflict')
        throw this.adminAccessMutationService.staleAccessError(before);

      const after = {
        memberKind: command.memberKind,
        hasStaffAccess: update.hasStaffAccess,
        hasAdminAccess: before.hasAdminAccess,
        role: update.role,
        accountStatus: before.accountStatus,
      };
      if (update.authorityChanged) {
        await this.auditLog.record(
          {
            actorGithubId,
            action: INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.SET_MEMBER_KIND,
            targetType: 'USER',
            targetId: before.id,
            metadata:
              this.auditLogMetadataService.createIndependentAuthorityAuditMetadata(
                {
                  command: INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.SET_MEMBER_KIND,
                  actor: {
                    displayName: actor.name,
                    githubLogin: actor.githubLogin,
                  },
                  target: {
                    displayName: before.name,
                    githubLogin: before.githubLogin,
                  },
                  before: {
                    memberKind: before.memberKind,
                    hasStaffAccess: before.hasStaffAccess,
                    hasAdminAccess: before.hasAdminAccess,
                    role: before.role,
                    accountStatus: before.accountStatus,
                  },
                  after,
                },
              ),
          },
          store.auditLogWriter,
        );
      }
      if (update.profileChanges.length > 0) {
        await this.auditLog.record(
          {
            actorGithubId,
            action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
            targetType: 'USER',
            targetId: before.id,
            metadata:
              this.auditLogMetadataService.createUserProfileAuditMetadata({
                actor: {
                  displayName: actor.name,
                  githubLogin: actor.githubLogin,
                },
                target: {
                  displayName: before.name,
                  githubLogin: before.githubLogin,
                },
                changes: update.profileChanges,
              }),
          },
          store.auditLogWriter,
        );
      }

      return {
        id: before.id,
        role: after.role,
        memberKind: after.memberKind,
        hasStaffAccess: after.hasStaffAccess,
        hasAdminAccess: after.hasAdminAccess,
        approvalStatus: outcome.approvalStatus,
        approvalRequestId: outcome.approvalRequestId,
      };
    });
  }
}

function assertCommandShape(command: MemberKindMutationCommand): void {
  if (
    command.memberKind !== MemberKind.STUDENT &&
    command.memberKind !== MemberKind.STAFF
  ) {
    throw validationError('지원하지 않는 회원 유형입니다.');
  }
  if (
    command.expectedMemberKind !== MemberKind.STUDENT &&
    command.expectedMemberKind !== MemberKind.STAFF
  ) {
    throw validationError('기대하는 회원 유형이 올바르지 않습니다.');
  }
  if (typeof command.expectedHasStaffAccess !== 'boolean') {
    throw validationError('기대하는 교직원 접근 상태가 올바르지 않습니다.');
  }
}

function validationError(message: string): DomainException {
  return new DomainException({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
    message,
  });
}
