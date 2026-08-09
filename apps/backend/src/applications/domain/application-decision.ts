import type {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
} from '@prisma/client';

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
  readonly decision:
    typeof ApplicationStatus.APPROVED | typeof ApplicationStatus.REJECTED;
  readonly decidedAt: Date;
}

export interface ApplicationTransition {
  readonly applicationId: string;
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
