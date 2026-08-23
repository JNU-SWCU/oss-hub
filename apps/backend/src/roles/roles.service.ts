import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import { ConsentsService } from '../consents/consents.service';
import { isCompleteProfileFields } from '../users/user-profile-policy';
import type {
  MemberKindSelectionResult,
  MemberKindSelectionState,
  MemberUser,
  SelectableMemberKind,
  StaffAccessRequestRecord,
} from './domain/member-onboarding';
import { RolesRepository } from './roles.repository';
import type {
  RolesRepositoryPort,
  RolesTransactionStore,
} from './roles.repository';
import { ROLES_ERROR_CODES, RolesErrorCode } from './roles-error-code.enum';

/**
 * 온보딩 순서: 약관 동의 → **회원 유형 선택** → 프로필 입력.
 *
 * 예전에는 선택이 마지막이었고, 이 서비스가 "완료된 프로필"을 선행 조건으로
 * 요구했다(`USR_002`). 그 순서에서는 프로필을 입력하는 시점에 유형이 없어서 프런트도
 * 백엔드도 가장 엄격한 학생 기준으로 되돌아갔고, 결국 학번이 필요 없는 교직원이
 * 가짜 학번을 지어내야 프로필을 통과할 수 있었다.
 *
 * 그래서 순서를 뒤집고 이 선행 조건도 함께 뒤집었다. 유형 선택은 더 이상 완료된
 * 프로필을 요구하지 않고, 대신 **프로필 완료 판정이 유형을 안다**. 동의(`CON_003`)는
 * 개인정보 경계라 그대로 선행 조건으로 남는다.
 *
 * ## 유형 선택은 아무것도 확정하지 않는다 (#569)
 *
 * 예전에는 이 화면이 누르는 즉시 확정했다 — **프로필을 한 글자도 입력하기 전에.**
 * 그래서 관리자 대기줄에는 이름·소속이 빈 미완성 신청이 올라갔고, 잘못 고른 사람은
 * 되돌릴 방법이 없었다.
 *
 * 이제 이 서비스는 **고른 유형을 기록만** 한다(`User.selectedMemberKind`). 확정은
 * 가입을 마치는 순간, 곧 프로필 행이 만들어지는 순간에 일어난다. 확정 전이므로
 * 사용자는 프로필 화면에서 여기로 되돌아와 다른 유형을 고를 수 있다.
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
   * 고른 회원 유형을 기록한다 — 확정하지 않는다.
   *
   * 이미 확정된 사람은 기록을 고칠 수 없다. 프로필 행이 있거나 승인을 기다리는
   * 요청이 있으면 그 사람은 가입을 마친 사람이고, 되돌리는 일은 기록을 고치는 것이
   * 아니라 회수·해제라 이 화면의 일이 아니다.
   */
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

      // 프로필을 **이미** 마친 사람에게는 남은 단계가 없다. 기록만 하고 끝내면 교직원
      // 요청이 영원히 열리지 않는다 — 프로필 화면이 "이미 완료"라며 그를 곧바로
      // 내보내기 때문에 `가입 마치기`를 누를 기회가 없다. 회수된 뒤 다시 고르는
      // 사용자가 그렇다. 여기서 열어도 미완성 신청이 대기줄에 올라가지 않는다 —
      // 그의 프로필은 채워져 있고, 그 사실을 방금 확인했다.
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

  /**
   * 지금 고른 회원 유형. 선택 화면이 다시 열릴 때 이전 선택을 되살리는 근거이고,
   * 프로필 화면이 무엇을 물을지 정하는 근거이기도 하다(#569).
   *
   * ## 회수는 이 값을 비우지 않는다 (#184)
   *
   * 회수 경로(`users/admin-access-*`)는 `selectedMemberKind`에 쓰지 않는다 — 바꾸는
   * 것은 `hasStaffAccess`와 요청 상태뿐이다. 그래서 회수된 교직원이 이 화면으로
   * 돌아오면 교직원이 골라진 상태로 보이는데, **그게 맞다.**
   *
   * 비우는 쪽이 더 깨끗해 보이지만 사실이 아닌 것을 만든다. 프로필 필수 항목 판정은
   * 확정된 유형이 없을 때 이 값을 근거로 삼고(`users/user-profile-policy.ts`의
   * `effectiveProfileMemberKind`), 근거가 없으면 가장 엄격한 학생 기준으로 되돌아간다.
   * 교직원은 학번이 필요 없어 이름·소속만 채워 둔 사람이 대부분이므로, 비우는 순간
   * **한 글자도 바뀌지 않은 프로필이 갑자기 "미완료"로 읽힌다**. 회수가 없앤 것은
   * 권한이지 그 사람이 입력해 둔 값이 아니다.
   */
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
      if (user.hasStaffAccess) {
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
        // `PENDING` 한 건뿐이고 교직원 접근을 켜는 것은 여전히 관리자의 승인이다. 두
        // 상태가 뜻하는 사실도 같다: **지금 접근 권한이 없고, 다시 교직원으로 가입하려
        // 한다.** 같은 사실이면 처리도 같아야 한다. 자세한 근거는 `requireSelectable`에.
        case StaffAccessRequestStatus.REJECTED:
        case StaffAccessRequestStatus.REVOKED:
          // 다시 요청한다는 것은 여전히 교직원으로 가입한다는 뜻이다. 기록을 함께
          // 맞춰 두지 않으면 프로필 필수 항목 판정이 그 사실을 모른다(#569).
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

  /**
   * 이미 확정된 사람인가.
   *
   * 확정의 근거는 프로필 행에 적힌 `memberKind`다. 같은 유형을 다시 고르는 것 하나만
   * 통과시킨다 — 아무것도 바뀌지 않는 조작이라 409로 막으면 오류 화면만 뜬다.
   */
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

  /**
   * 살아 있는 요청이 이 선택을 허락하는가. 유형마다 답이 다르다.
   *
   * - **학생**: 승인 대기 요청이 있으면 거부한다. 교직원 신청을 남겨 둔 채 학생으로
   *   넘어가면 승인이 났을 때 두 사실이 겹친다.
   * - **교직원**: 언제나 통과시킨다. 승인 대기 요청이 있어도 같은 선택을 한 번 더 누른
   *   것뿐이라 바뀔 것이 없고, 여기서 409를 주면 '선택 완료'를 두 번 누른 사람이 오류
   *   화면을 본다.
   *
   * ## 회수된 이력은 더 이상 교직원 선택을 막지 않는다 (#184)
   *
   * 예전에는 대기 요청이 없고 **회수된**(`REVOKED`) 이력만 있으면 `ROL_008`로 막았고,
   * 그 근거는 *"관리자가 떼어낸 권한을 가입 절차로 되돌리는 길이 되기 때문"*이었다.
   * 지우지 않고 남겨 두는 이유는, 근거 없이 지우면 다음 사람이 같은 논쟁을 처음부터
   * 다시 하기 때문이다.
   *
   * 뒤집는 이유는 그 문장이 전제한 **되돌림이 실제로는 일어나지 않기** 때문이다.
   *
   * - 이 화면은 고른 유형을 기록만 하고 아무것도 확정하지 않는다(#569). 교직원 재신청도
   *   `PENDING` 한 건을 만들 뿐이고, `hasStaffAccess`를 켜는 것은 여전히 관리자의
   *   승인이다 — 사용자가 자기 손으로 회수된 권한을 되찾는 경로는 어디에도 없다.
   * - 동시 신청은 `StaffAccessRequest_userId_pending_key`(partial unique)가 1건으로
   *   묶으므로 대기줄을 밀어 넣는 길도 아니다. 남는 비용은 권한 상승 위험이 아니라
   *   같은 사람이 반복 신청할 때의 **관리자 피로도**뿐이다.
   * - 실질 방어선은 `requireUnconfirmed`가 이미 지킨다.
   */
  private async requireSelectable(
    store: RolesTransactionStore,
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
    store: RolesTransactionStore,
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
