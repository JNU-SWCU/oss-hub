import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import { ConsentsService } from '../consents/consents.service';
import { UsersService } from '../users/users.service';
import type { RoleRequestRecord, RoleUser } from './domain/role-onboarding';
import type {
  RoleSelectionResult,
  SelectableRole,
} from './domain/role-onboarding';
import { RolesRepository } from './roles.repository';
import type {
  RolesRepositoryPort,
  RolesTransactionStore,
} from './roles.repository';
import { ROLES_ERROR_CODES, RolesErrorCode } from './roles-error-code.enum';

@Injectable()
export class RolesService {
  constructor(
    @Inject(RolesRepository)
    private readonly repository: RolesRepositoryPort,
    @Inject(ConsentsService)
    private readonly consentsService: Pick<ConsentsService, 'requireCurrent'>,
    @Inject(UsersService)
    private readonly usersService: Pick<UsersService, 'requireCompleteProfile'>,
  ) {}

  async selectRole(
    githubId: bigint,
    selectedRole: SelectableRole,
  ): Promise<RoleSelectionResult> {
    await this.consentsService.requireCurrent(githubId);
    await this.usersService.requireCompleteProfile(githubId);

    return this.repository.withTransaction(async (store) => {
      const user = await this.requireUser(store, githubId);
      switch (selectedRole) {
        case Role.STUDENT:
          return this.selectStudent(store, user);
        case Role.STAFF:
          return this.selectStaff(store, user);
        default: {
          const exhaustiveRole: never = selectedRole;
          return exhaustiveRole;
        }
      }
    });
  }

  async getMyRequest(githubId: bigint): Promise<RoleRequestRecord | null> {
    const user = await this.repository.findUserByGithubId(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return this.repository.findLatestRequest(user.id);
  }

  async retryStaffRequest(githubId: bigint): Promise<RoleRequestRecord> {
    await this.consentsService.requireCurrent(githubId);
    await this.usersService.requireCompleteProfile(githubId);

    return this.repository.withTransaction(async (store) => {
      const user = await this.requireUser(store, githubId);
      if (user.role !== null) {
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
        case RoleRequestStatus.REJECTED:
          return store.createPendingRequest(user.id);
        case RoleRequestStatus.REVOKED:
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ROLE_STATE_CONFLICT],
          );
        case RoleRequestStatus.PENDING:
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ACTIVE_REQUEST_EXISTS],
          );
        case RoleRequestStatus.APPROVED:
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.ROLE_ALREADY_CONFIRMED],
          );
      }
    });
  }

  private async selectStudent(
    store: RolesTransactionStore,
    user: RoleUser,
  ): Promise<RoleSelectionResult> {
    if (user.role !== null && user.role !== Role.STUDENT) {
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
    if (user.role === null) {
      await store.updateUserRole(user.id, Role.STUDENT);
    }
    return {
      selectedRole: Role.STUDENT,
      role: Role.STUDENT,
      requestStatus: null,
      redirectTo: '/programs',
    };
  }

  private async selectStaff(
    store: RolesTransactionStore,
    user: RoleUser,
  ): Promise<RoleSelectionResult> {
    if (user.role !== null) {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.ROLE_ALREADY_CONFIRMED],
      );
    }
    const latest = await store.findLatestRequest(user.id);
    if (latest?.status === RoleRequestStatus.REVOKED) {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.ROLE_STATE_CONFLICT],
      );
    }
    const request =
      (await store.findPendingRequest(user.id)) ??
      (await store.createPendingRequest(user.id));
    return {
      selectedRole: Role.STAFF,
      role: null,
      requestStatus: request.status,
      redirectTo: '/onboarding/pending',
    };
  }

  private async requireUser(
    store: RolesTransactionStore,
    githubId: bigint,
  ): Promise<RoleUser> {
    const user = await store.findUserByGithubId(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return user;
  }
}
