import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import { ConsentsService } from '../consents/consents.service';
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

/**
 * 온보딩 순서: 약관 동의 → **역할 선택** → 프로필 입력.
 *
 * 예전에는 역할 선택이 마지막이었고, 이 서비스가 "완료된 프로필"을 선행 조건으로
 * 요구했다(`USR_002`). 그 순서에서는 프로필을 입력하는 시점에 역할이 없어서 프런트도
 * 백엔드도 가장 엄격한 학생 기준으로 되돌아갔고, 결국 학번이 필요 없는 교직원·관리자가
 * 가짜 학번을 지어내야 프로필을 통과할 수 있었다 — 역할별 필수 항목을 만든 이유가
 * 그 화면에서 무너진 것이다.
 *
 * 그래서 순서를 뒤집고 이 선행 조건도 함께 뒤집었다. 역할 배정은 더 이상 완료된 프로필을
 * 요구하지 않고, 대신 **프로필 완료 판정이 역할을 안다**. 동의(`CON_003`)는 개인정보
 * 경계라 그대로 선행 조건으로 남는다.
 *
 * 프로필이 비어 있는 채로 역할이 정해질 수 있으므로 다음 단계로 미는 책임은 화면의
 * 게이트가 진다 — 미배정 사용자는 `OnboardingGate`, 배정된 사용자는 `RoleGate`가
 * 프로필 미완료를 보고 `/onboarding/profile`로 보낸다. 여기서 `redirectTo`를 다시
 * 계산하지 않는 이유는, 목적지 판단이 두 곳으로 갈라지면 반드시 어긋나기 때문이다.
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject(RolesRepository)
    private readonly repository: RolesRepositoryPort,
    @Inject(ConsentsService)
    private readonly consentsService: Pick<ConsentsService, 'requireCurrent'>,
  ) {}

  async selectRole(
    githubId: bigint,
    selectedRole: SelectableRole,
  ): Promise<RoleSelectionResult> {
    await this.consentsService.requireCurrent(githubId);

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
      // 역할이 정해졌다고 가입이 끝난 것은 아니다. 프로필을 받아야 가입이
      // 완결되므로 남은 단계로 보낸다. 예전에는 `/programs` 로 보냈는데,
      // 그 화면은 비로그인도 볼 수 있어 게이트가 없다 — 학생이 프로필을
      // 비운 채 둘러보다 나중에 막히는 상태가 만들어졌다.
      redirectTo: '/onboarding/profile',
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
      // 학생과 같은 이유로 남은 단계를 가리킨다. 교직원도 학과가 필수라
      // (`users/user-profile-policy.ts`의 `STAFF: { department: true }`) 역할을
      // 골랐다고 가입이 끝난 것이 아니다. 예전에는 `/onboarding/pending`을 줬는데,
      // 그 화면의 `OnboardingGate`가 비어 있는 프로필을 보고 즉시
      // `/onboarding/profile`로 다시 보내 승인 대기 화면이 반 초쯤 깜빡였다
      // — 아직 오지 않은 승인을 기다리라고 말한 뒤 곧바로 취소한 셈이다.
      //
      // 여기서 프로필 완료 여부를 다시 계산하지는 않는다. 목적지 판단이 두 곳으로
      // 갈라지면 반드시 어긋나기 때문이다(위 클래스 주석). 프로필을 마친 뒤
      // 승인 대기로 잇는 일은 그대로 화면의 게이트가 한다.
      redirectTo: '/onboarding/profile',
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
