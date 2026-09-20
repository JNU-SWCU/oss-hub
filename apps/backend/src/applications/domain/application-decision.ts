import type {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
} from '@prisma/client';

/**
 * `APPROVE`는 SUBMITTED·REJECTED에서, `REJECT`는 SUBMITTED·APPROVED에서 받는다 —
 * 반대 판정으로 뒤집는 데 되돌리기를 먼저 요구하지 않는다(#1272).
 * `REVERT`는 UI에서 내렸지만 backend API·이력으로는 계속 지원한다.
 *
 * 세 전이 모두 프로비저닝 완료 여부와 무관하게 허용된다. 교직원이 드롭다운에서 고르는
 * 세 상태는 어느 출발점에서도 항상 고를 수 있어야 하기 때문에 완료 잠금(옵 APP_023)을
 * 없았다. 완료된 프로비저닝은 차단 사유가 아니라 **보존 사유**다 — 잡·outbox 이벤트·
 * 저장소 연결을 지우지 않고 새 프로비저닝도 다시 발행하지 않는다.
 */
export const APPLICATION_DECISION_ACTIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REVERT: 'REVERT',
} as const;

export type ApplicationDecisionAction =
  | { readonly action: typeof APPLICATION_DECISION_ACTIONS.APPROVE }
  | {
      readonly action: typeof APPLICATION_DECISION_ACTIONS.REJECT;
      readonly reason: string;
    }
  | { readonly action: typeof APPLICATION_DECISION_ACTIONS.REVERT };

export interface ApplicationDecisionTarget {
  readonly id: string;
  readonly programId: string;
  readonly programName: string;
  // 신청자(팀 신청이어도 대표 신청자 한 명)의 GitHub 로그인. 감사 로그가 이 신청 행을
  // "누구의 어느 프로그램 신청인지" 라벨로 보이려고 쓴다 — 실명은 담지 않는다(applicant는
  // Application.applicantId FK로 항상 존재하므로 팀 신청에도 null이 아니다).
  readonly applicantGithubLogin: string;
  readonly teamId: string | null;
  readonly status: ApplicationStatus;
  readonly repositoryProvisioningEnabled: boolean;
  readonly collaboratorGithubLogins: readonly string[];
  readonly notificationRecipientIds: readonly string[];
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
  readonly processedById: string | null;
  readonly processedAt: Date | null;
}

export interface ApplicationDecisionNotificationInput {
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly recipientUserIds: readonly string[];
  /**
   * 전이한 다음 상태. 승인·반려뿐 아니라 되돌림(→`SUBMITTED`)도 학생에게 알린다 —
   * 승인되었던 신청이 다시 검토 대기로 돌아가는 것은 학생이 알아야 하는 사실이고,
   * 알리지 않으면 화면을 다시 열어보기 전까지 손을 대야 하는지 알 수 없다.
   */
  readonly decision: ApplicationStatus;
  readonly decidedAt: Date;
}

export interface ApplicationTransition {
  readonly applicationId: string;
  /**
   * CAS의 기대 상태 — 판정 계획이 읽은 출발 상태를 그대로 싣는다. 승인·반려가
   * 반대 판정에서도 출발하므로 SUBMITTED로 고정할 수 없다. 이 값이 어긋나면
   * 갱신 건수가 0이 되어 409로 되돌아간다(경합한 요청이 밀린다).
   */
  readonly expectedStatus: ApplicationStatus;
  readonly nextStatus: ApplicationStatus;
  readonly rejectionReason: string | null;
  /**
   * 승인·반려는 actor/시각을 기록한다. 되돌리기는 감사 추적을 보존하려고
   * `preserve`로 두어 `processedById`/`processedAt`을 덮어쓰지 않는다.
   */
  readonly processedBy: { readonly id: string; readonly at: Date } | 'preserve';
}

export interface RepositoryProvisionEventInput {
  readonly applicationId: string;
  readonly programId: string;
  readonly teamId: string | null;
  readonly collaboratorGithubLogins: readonly string[];
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
  readonly idempotencyKey: string;
  readonly requestedAt: Date;
}

export interface RepositoryProvisionEvent {
  readonly id: string;
}

export interface RepositoryProvisionJobSnapshot {
  readonly status: RepositoryProvisionJobStatus;
  readonly repositoryId: string | null;
}

export type ApplicationDecisionResult =
  | {
      readonly kind: 'APPROVED';
      readonly applicationId: string;
      readonly status: ApplicationStatus;
      readonly repositoryProvisioning: {
        readonly enabled: boolean;
        readonly eventId: string | null;
        readonly jobStatus: RepositoryProvisionJobStatus | null;
      };
    }
  | {
      readonly kind: 'REJECTED';
      readonly applicationId: string;
      readonly status: ApplicationStatus;
      readonly rejectionReason: string;
    }
  | {
      readonly kind: 'REVERTED';
      readonly applicationId: string;
      readonly status: ApplicationStatus;
    };
