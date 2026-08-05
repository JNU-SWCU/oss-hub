import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import { ConsentsService } from '../consents/consents.service';
import { isCompleteProfileFields } from '../users/user-profile-policy';
import type { RoleRequestRecord, RoleUser } from './domain/role-onboarding';
import type {
  RoleSelectionResult,
  RoleSelectionState,
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
 *
 * ## 역할 선택은 아무것도 확정하지 않는다 (#569)
 *
 * 예전에는 이 화면이 누르는 즉시 확정했다 — 학생은 그 자리에서 `User.role`이 붙고,
 * 교직원은 그 자리에서 승인 요청이 만들어졌다. **프로필을 한 글자도 입력하기 전에.**
 * 그래서 관리자 대기줄에는 이름·학과가 빈 미완성 신청이 올라갔고, 역할을 잘못 고른
 * 사람은 되돌릴 방법이 없었다(확정된 뒤라 되돌리려면 회수·해제가 필요해진다).
 *
 * 이제 이 서비스는 **고른 역할을 기록만** 한다(`User.selectedRole`). 확정은 가입을
 * 마치는 순간, 곧 프로필이 그 역할 기준으로 완료되는 순간에 일어난다
 * (`role-confirmation.ts`). 확정 전이므로 사용자는 프로필 화면에서 여기로 되돌아와
 * 다른 역할을 고를 수 있고, 그것은 기록을 바꾸는 일일 뿐이라 회수·해제가 필요 없다.
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject(RolesRepository)
    private readonly repository: RolesRepositoryPort,
    @Inject(ConsentsService)
    private readonly consentsService: Pick<ConsentsService, 'requireCurrent'>,
  ) {}

  /**
   * 고른 역할을 기록한다 — 확정하지 않는다.
   *
   * 이미 확정된 사람은 기록을 고칠 수 없다. 역할이 붙었거나(`role`) 승인을 기다리는
   * 요청이 있으면 그 사람은 가입을 마친 사람이고, 되돌리는 일은 기록을 고치는 것이
   * 아니라 회수·해제라 이 화면의 일이 아니다.
   */
  async selectRole(
    githubId: bigint,
    selectedRole: SelectableRole,
  ): Promise<RoleSelectionResult> {
    await this.consentsService.requireCurrent(githubId);

    return this.repository.withTransaction(async (store) => {
      const user = await this.requireUser(store, githubId);
      this.requireUnconfirmed(user, selectedRole);
      await this.requireSelectable(store, user, selectedRole);

      const recorded = await store.updateSelectedRole(user.id, selectedRole);

      // 프로필을 **이미** 마친 사람에게는 남은 단계가 없다. 기록만 하고 끝내면 확정이
      // 영원히 오지 않는다 — 프로필 화면이 "이미 완료"라며 그를 곧바로 내보내기 때문에
      // `가입 마치기`를 누를 기회가 없다. 회수된 뒤 역할을 다시 고르는 사용자가 그렇다.
      // 여기서 확정해도 미완성 신청이 대기줄에 올라가지 않는다 — 그의 프로필은 채워져
      // 있고, 그 사실을 방금 확인했다.
      if (isCompleteProfileFields(recorded.profile, selectedRole)) {
        await store.confirmSelectedRole(recorded);
      }

      return { selectedRole, redirectTo: '/onboarding/profile' };
    });
  }

  /**
   * 지금 고른 역할. 역할 선택 화면이 다시 열릴 때 이전 선택을 되살리는 근거이고,
   * 프로필 화면이 무엇을 물을지 정하는 근거이기도 하다(#569).
   *
   * 확정된 역할(`role`)은 여기서 답하지 않는다 — 그쪽은 세션(`auth/me`)이 이미 싣고
   * 있고, 두 곳이 같은 사실을 답하면 어느 쪽이 최신인지 화면이 판단해야 한다.
   *
   * ## 회수는 이 값을 비우지 않는다 (#184)
   *
   * 회수 경로(`users/admin-access-*`)는 `selectedRole`에 쓰지 않는다 — 바꾸는 것은
   * `User.role`과 요청 상태뿐이다. 그래서 회수된 교직원이 이 화면으로 돌아오면 교직원이
   * 골라진 상태로 보이는데, **그게 맞다.**
   *
   * 비우는 쪽이 더 깨끗해 보이지만 사실이 아닌 것을 만든다. 프로필 필수 항목 판정은
   * 확정 역할이 없을 때 이 값을 근거로 삼고(`users/user-profile-policy.ts`의
   * `effectiveProfileRole`), 근거가 없으면 가장 엄격한 학생 기준으로 되돌아간다.
   * 교직원은 학번이 필요 없어 이름·학과만 채워 둔 사람이 대부분이므로, 비우는 순간
   * **한 글자도 바뀌지 않은 프로필이 갑자기 "미완료"로 읽힌다** — 관리자 목록에도 그렇게
   * 뜬다. 회수가 없앤 것은 권한이지 그 사람이 입력해 둔 값이 아니다.
   *
   * 되돌리고 싶은 사용자에게는 길이 열려 있다: 학생을 고르면 이 값이 그 자리에서
   * 덮어써진다(`selectRole`). 회수가 대신 골라 줄 일이 아니다.
   */
  async getMySelection(githubId: bigint): Promise<RoleSelectionState> {
    const user = await this.repository.findUserByGithubId(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return { selectedRole: toSelectableRole(user.selectedRole) };
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
        // 반려(`REJECTED`)와 회수(`REVOKED`)는 같은 갈래다 (#184).
        //
        // 예전에는 회수만 `ROL_008`로 막았고, 그 근거는 "관리자가 떼어낸 권한을 가입
        // 절차로 되돌리는 길이 된다"였다. 되돌아가지 않는다 — 이 문이 만드는 것은
        // `PENDING` 한 건뿐이고 STAFF를 붙이는 것은 여전히 관리자의 승인이다. 두 상태가
        // 뜻하는 사실도 같다: **지금 역할이 없고, 다시 교직원으로 가입하려 한다.**
        // 같은 사실이면 처리도 같아야 하고, 갈래를 나눠 두면 그 차이가 무엇을 뜻하는지
        // 아무도 답할 수 없게 된다. 자세한 판단 근거는 `requireSelectable`에 적었다.
        case RoleRequestStatus.REJECTED:
        case RoleRequestStatus.REVOKED:
          // 다시 요청한다는 것은 여전히 교직원으로 가입한다는 뜻이다. 기록을 함께
          // 맞춰 두지 않으면 프로필 필수 항목 판정이 그 사실을 모른다(#569).
          await store.updateSelectedRole(user.id, Role.STAFF);
          return store.createPendingRequest(user.id);
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

  /**
   * 이미 확정된 사람인가.
   *
   * 학생으로 확정된 사람이 학생을 다시 고르는 것 하나만 통과시킨다 — 아무것도 바뀌지
   * 않는 조작이라 409로 막으면 오류 화면만 뜬다. 예전 `selectStudent`가 갖고 있던
   * 예외를 그대로 옮겼고, 나머지 조합의 엄격함도 그대로 남겼다.
   */
  private requireUnconfirmed(
    user: RoleUser,
    selectedRole: SelectableRole,
  ): void {
    const isHarmlessRepeat =
      selectedRole === Role.STUDENT && user.role === Role.STUDENT;
    if (user.role !== null && !isHarmlessRepeat) {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.ROLE_ALREADY_CONFIRMED],
      );
    }
  }

  /**
   * 살아 있는 요청이 이 선택을 허락하는가 — 예전 `selectStudent`·`selectStaff`가
   * 나눠 갖고 있던 규칙을 그대로 옮겼다. 역할마다 답이 다르다.
   *
   * - **학생**: 승인 대기 요청이 있으면 거부한다. 교직원 신청을 남겨 둔 채 학생으로
   *   넘어가면 승인이 났을 때 두 역할이 겹친다.
   * - **교직원**: 언제나 통과시킨다. 승인 대기 요청이 있어도 같은 선택을 한 번 더 누른
   *   것뿐이라 바뀔 것이 없고, 여기서 409를 주면 '선택 완료'를 두 번 누른 사람이 오류
   *   화면을 본다.
   *
   * ## 회수된 이력은 더 이상 교직원 선택을 막지 않는다 (#184)
   *
   * 예전에는 대기 요청이 없고 **회수된**(`REVOKED`) 이력만 있으면 `ROL_008`로 막았고,
   * 그 자리에 이런 근거가 적혀 있었다: *"관리자가 떼어낸 권한을 가입 절차로 되돌리는
   * 길이 되기 때문이다."* 지우지 않고 남겨 두는 이유는, 근거 없이 지우면 다음 사람이
   * 같은 논쟁을 처음부터 다시 하기 때문이다.
   *
   * 뒤집는 이유는 그 문장이 전제한 **되돌림이 실제로는 일어나지 않기** 때문이다.
   *
   * - 이 화면은 고른 역할을 기록만 하고 아무것도 확정하지 않는다(#569). 교직원 재신청도
   *   `PENDING` 한 건을 만들 뿐이고, STAFF를 붙이는 것은 여전히 관리자의 승인이다 —
   *   사용자가 자기 손으로 회수된 권한을 되찾는 경로는 이 갈래 어디에도 없다.
   * - 동시 신청은 `RoleRequest_userId_pending_key`(partial unique)가 1건으로 묶으므로
   *   대기줄을 밀어 넣는 길도 아니다. 남는 비용은 권한 상승 위험이 아니라 같은 사람이
   *   반복 신청할 때의 **관리자 피로도**뿐이다.
   * - 실질 방어선은 `requireUnconfirmed`가 이미 지킨다 — `role`이 붙어 있으면 거부한다.
   *   회수로 `role`이 비면 열리고, 재승인되면 다시 잠긴다. **"확정된 사람은 못 바꾼다"는
   *   불변식은 그대로다.**
   *
   * 막아 둔 동안 제품은 스스로와 어긋나 있었다: 회수 화면(`role-request-screen.tsx`)이
   * "학생 또는 교직원 역할을 다시 선택할 수 있습니다"라고 안내하며 `/onboarding/role`로
   * 보내는데, 거기서 교직원을 누르면 409가 떴다. #184의 인수 조건이 그 안내 쪽을 정답으로
   * 확정했다.
   */
  private async requireSelectable(
    store: RolesTransactionStore,
    user: RoleUser,
    selectedRole: SelectableRole,
  ): Promise<void> {
    if (selectedRole === Role.STAFF) {
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

/**
 * 기록된 역할을 **고를 수 있는 역할**로 좁힌다.
 *
 * 컬럼 타입은 `Role`이라 ADMIN도 담을 수 있지만 역할 선택 화면에는 그 값이 없다.
 * 그대로 흘리면 화면이 목록에 없는 값을 선택 상태로 그리려다 아무것도 못 고른 것처럼
 * 보인다. 관리자는 `role`이 이미 붙어 있어 이 값을 쓰지 않는다.
 */
function toSelectableRole(role: Role | null): SelectableRole | null {
  return role === Role.STUDENT || role === Role.STAFF ? role : null;
}
