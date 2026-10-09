import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import {
  AUTH_ERROR_CODES,
  AuthErrorCode,
} from '../../auth/domain/auth-error-code.enum';
import { DomainException } from '../../common/error-code';
import { ConsentsService } from '../../consents/consents.service';
import { isCompleteProfileFields } from '../../users/domain/user-profile-policy';
import type {
  MemberKindSelectionResult,
  MemberKindSelectionState,
  MemberUser,
  SelectableMemberKind,
  StaffAccessRequestRecord,
} from '../../users/domain/member-onboarding';
import { UsersOnboardingService } from '../../users/service/onboarding.service';
import type {
  OnboardingRepositoryPort,
  OnboardingTransactionStore,
} from '../../users/domain/onboarding-store';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../../users/domain/roles-error-code.enum';

@Injectable()
export class RolesService {
  constructor(
    @Inject(UsersOnboardingService)
    private readonly repository: OnboardingRepositoryPort,
    @Inject(ConsentsService)
    private readonly consentsService: Pick<ConsentsService, 'requireCurrent'>,
  ) {}

  async selectMemberKind(
    githubId: bigint,
    selectedMemberKind: SelectableMemberKind,
  ): Promise<MemberKindSelectionResult> {
    await this.consentsService.requireCurrent(githubId);

    return this.repository.withTransaction(async (store) => {
      const user = await this.requireUser(store, githubId);
      this.requireUnconfirmed(user, selectedMemberKind);
      await this.requireSelectable(store, user, selectedMemberKind);

      const recorded = await store.updateSelectedMemberKind(
        user.id,
        selectedMemberKind,
      );

      if (isCompleteProfileFields(recorded.profile, selectedMemberKind)) {
        await store.requestStaffAccess({
          id: recorded.id,
          memberKind: selectedMemberKind,
          hasStaffAccess: recorded.hasStaffAccess,
        });
      }

      return { selectedMemberKind, redirectTo: '/onboarding/profile' };
    });
  }

  async getMySelection(githubId: bigint): Promise<MemberKindSelectionState> {
    const user = await this.repository.findUserByGithubId(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return { selectedMemberKind: user.selectedMemberKind };
  }

  async getMyRequest(
    githubId: bigint,
  ): Promise<StaffAccessRequestRecord | null> {
    const user = await this.repository.findUserByGithubId(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return this.repository.findLatestRequest(user.id);
  }

  async retryStaffRequest(githubId: bigint): Promise<StaffAccessRequestRecord> {
    await this.consentsService.requireCurrent(githubId);

    return this.repository.withTransaction(async (store) => {
      const user = await this.requireUser(store, githubId);
      if (user.hasStaffAccess || user.memberKind === MemberKind.STUDENT) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.ROLE_ALREADY_CONFIRMED],
        );
      }
      const pending = await store.findPendingRequest(user.id);
      if (pending) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.ACTIVE_REQUEST_EXISTS],
        );
      }
      const latest = await store.findLatestRequest(user.id);
      if (!latest) {
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.INVALID_ROLE_SELECTION],
        );
      }
      switch (latest.status) {
        case StaffAccessRequestStatus.REJECTED:
        case StaffAccessRequestStatus.REVOKED:
          await store.updateSelectedMemberKind(user.id, MemberKind.STAFF);
          return store.createPendingRequest(user.id);
        case StaffAccessRequestStatus.PENDING:
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ACTIVE_REQUEST_EXISTS],
          );
        case StaffAccessRequestStatus.APPROVED:
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ROLE_ALREADY_CONFIRMED],
          );
      }
    });
  }

  private requireUnconfirmed(
    user: MemberUser,
    selectedMemberKind: SelectableMemberKind,
  ): void {
    const isHarmlessRepeat = user.memberKind === selectedMemberKind;
    if (user.memberKind !== null && !isHarmlessRepeat) {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.ROLE_ALREADY_CONFIRMED],
      );
    }
  }

  private async requireSelectable(
    store: OnboardingTransactionStore,
    user: MemberUser,
    selectedMemberKind: SelectableMemberKind,
  ): Promise<void> {
    if (selectedMemberKind === MemberKind.STAFF) {
      return;
    }
    const pending = await store.findPendingRequest(user.id);
    if (pending) {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.ACTIVE_REQUEST_EXISTS],
      );
    }
  }

  private async requireUser(
    store: OnboardingTransactionStore,
    githubId: bigint,
  ): Promise<MemberUser> {
    const user = await store.findUserByGithubId(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return user;
  }
}
