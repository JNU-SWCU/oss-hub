import type {
  ApplicationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import type { ApplicationDecisionResult } from '../domain/application-decision';

export interface ApprovedApplicationDecisionResponseDto {
  readonly applicationId: string;
  readonly status: ApplicationStatus;
  readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly eventId: string | null;
    readonly jobStatus: RepositoryProvisionJobStatus | null;
  };
}

export interface RejectedApplicationDecisionResponseDto {
  readonly applicationId: string;
  readonly status: ApplicationStatus;
  readonly rejectionReason: string;
}

export interface RevertedApplicationDecisionResponseDto {
  readonly applicationId: string;
  readonly status: ApplicationStatus;
}

export type ApplicationDecisionResponseDto =
  | ApprovedApplicationDecisionResponseDto
  | RejectedApplicationDecisionResponseDto
  | RevertedApplicationDecisionResponseDto;

export function toApplicationDecisionResponse(
  result: ApplicationDecisionResult,
): ApplicationDecisionResponseDto {
  switch (result.kind) {
    case 'APPROVED':
      return {
        applicationId: result.applicationId,
        status: result.status,
        repositoryProvisioning: result.repositoryProvisioning,
      };
    case 'REJECTED':
      return {
        applicationId: result.applicationId,
        status: result.status,
        rejectionReason: result.rejectionReason,
      };
    case 'REVERTED':
      return {
        applicationId: result.applicationId,
        status: result.status,
      };
    default: {
      const exhaustiveResult: never = result;
      return exhaustiveResult;
    }
  }
}
