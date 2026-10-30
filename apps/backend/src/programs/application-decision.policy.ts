import { DomainException } from '../platform/error-code.error';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.error';
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

  readonly decision: ApplicationStatus;
  readonly decidedAt: Date;
}

export interface ApplicationTransition {
  readonly applicationId: string;

  readonly expectedStatus: ApplicationStatus;
  readonly nextStatus: ApplicationStatus;
  readonly rejectionReason: string | null;

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

export type ApplicationDecisionCommand = {
  readonly action: string;
  readonly reason?: string;
};

export function applicationDecisionAction(
  input: ApplicationDecisionCommand,
): ApplicationDecisionAction {
  switch (input.action) {
    case APPLICATION_DECISION_ACTIONS.APPROVE:
      return { action: APPLICATION_DECISION_ACTIONS.APPROVE };
    case APPLICATION_DECISION_ACTIONS.REJECT: {
      const reason = input.reason?.trim();
      if (!reason) {
        throw new DomainException(
          APPLICATIONS_ERROR_CODES[
            ApplicationsErrorCode.REJECTION_REASON_REQUIRED
          ],
        );
      }
      return { action: APPLICATION_DECISION_ACTIONS.REJECT, reason };
    }
    case APPLICATION_DECISION_ACTIONS.REVERT:
      return { action: APPLICATION_DECISION_ACTIONS.REVERT };
    default:
      throw new DomainException(
        APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.INVALID_DECISION_ACTION],
      );
  }
}
