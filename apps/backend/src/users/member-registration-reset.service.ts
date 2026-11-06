import { Inject, Injectable } from '@nestjs/common';
import type { ApprovalStatus } from '@prisma/client';
import { UserHistoryRepository } from './user-history.repository';
import {
  MemberRegistrationResetRepository,
  type MemberRegistrationResetPort,
} from './member-registration-reset.repository';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
import { RolesErrorCode } from './roles-error-code.error';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import {
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  INDEPENDENT_AUTHORITY_AUDIT_COMMANDS,
} from '../platform/history-metadata.config';
import type { IndependentAuthorityMutationResult } from './independent-authority.repository';
export interface MemberRegistrationResetRequest {
  readonly expectedMemberKind: 'STUDENT' | 'STAFF';
  readonly expectedApprovalStatus: ApprovalStatus;
  readonly expectedApprovalRequestId: string | null;
}
@Injectable()
export class MemberRegistrationResetService {
  constructor(
    @Inject(MemberRegistrationResetRepository)
    private readonly repository: MemberRegistrationResetPort,
    @Inject(UserHistoryRepository)
    private readonly userHistory: Pick<UserHistoryRepository, 'record'>,
    private readonly metadata: HistoryMetadataService,
    private readonly profiles: UserProfileService,
    private readonly mutations: AdminAccessMutationService,
  ) {}
  resetFromRequest(
    actorGithubId: bigint,
    userId: string,
    command: MemberRegistrationResetRequest,
  ): Promise<IndependentAuthorityMutationResult> {
    this.mutations.requireValidUserId(userId);
    return this.repository.withTransaction(async (store) => {
      await store.lockActiveAdmins();
      const actor = this.mutations.requireActiveAdmin(
        await store.findActorByGithubId(actorGithubId),
      );
      const target = await store.findTargetForUpdate(userId);
      if (!target)
        throw this.mutations.roleError(RolesErrorCode.USER_NOT_FOUND);
      const memberKind = target.type === 'UNSELECTED' ? null : target.type;
      const hasStaffAccess = this.profiles.hasStaffAccess({
        name: target.name,
        memberKind,
        approvalStatus: target.approvalStatus,
        profileCreatedAt: target.profileCreatedAt,
        department: target.department,
      });
      const before = {
        memberKind,
        hasStaffAccess,
        hasAdminAccess: target.admin !== null,
        role: this.profiles.authorityLabel({
          memberKind,
          hasStaffAccess,
          hasAdminAccess: target.admin !== null,
        }),
        accountStatus: target.accountStatus,
      };
      const stale = () =>
        this.mutations.staleAccessError({
          id: target.id,
          role: before.role,
          accountStatus: target.accountStatus,
          pendingRequest:
            target.approvalStatus === 'PENDING' &&
            target.approvalRequestId &&
            target.approvalRequestedAt
              ? {
                  id: target.approvalRequestId,
                  status: 'PENDING',
                  createdAt: target.approvalRequestedAt,
                }
              : null,
        });
      if (actor.id === target.id)
        throw this.mutations.roleError(
          RolesErrorCode.SELF_REGISTRATION_RESET_FORBIDDEN,
        );
      if (
        memberKind === null ||
        memberKind !== command.expectedMemberKind ||
        target.approvalStatus !== command.expectedApprovalStatus ||
        target.approvalRequestId !== command.expectedApprovalRequestId
      )
        throw stale();
      if (target.admin !== null)
        throw this.mutations.roleError(
          RolesErrorCode.ADMIN_REGISTRATION_RESET_FORBIDDEN,
        );
      if (await store.hasActivity(userId))
        throw this.mutations.roleError(
          RolesErrorCode.ACTIVE_REGISTRATION_RESET_FORBIDDEN,
        );
      if (!(await store.resetRegistration(target, actor.id))) throw stale();
      const after = {
        memberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
        role: null,
        accountStatus: target.accountStatus,
      };
      await this.userHistory.record(
        {
          actorGithubId,
          action: INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.RESET_MEMBER_KIND,
          targetType: 'USER',
          targetId: userId,
          beforeProfile: {
            name: target.name,
            department: target.department,
            departmentType: target.departmentType,
            studentId: target.studentId,
            staffNumber: target.staffNumber,
            phone: target.phone,
            profileCreatedAt: target.profileCreatedAt?.toISOString() ?? null,
            profileUpdatedAt: target.profileUpdatedAt?.toISOString() ?? null,
          },
          metadata: this.metadata.createIndependentAuthorityAuditMetadata({
            command: INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.RESET_MEMBER_KIND,
            actor: { displayName: actor.name, githubLogin: actor.githubLogin },
            target: { displayName: target.name, githubLogin: target.nickname },
            before,
            after,
          }),
        },
        store.userHistoryWriter,
      );
      return {
        id: userId,
        memberKind: null,
        role: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
        approvalStatus: 'NOT_REQUIRED',
        approvalRequestId: null,
      };
    });
  }
}
