import {
  ApplicationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import type { ProblemDetailExtensions } from '../common/error-code';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';
import {
  ApplicationsRepository,
  RepositoryEventAlreadyExistsError,
} from './applications.repository';
import type {
  ApplicationDecisionAction,
  ApplicationDecisionResult,
} from './domain/application-decision';
import { APPLICATION_DECISION_ACTIONS } from './domain/application-decision';

type ApplicationDecisionPlan =
  | {
      readonly kind: 'APPROVE';
      readonly status: typeof ApplicationStatus.APPROVED;
      readonly rejectionReason: null;
    }
  | {
      readonly kind: 'REJECT';
      readonly status: typeof ApplicationStatus.REJECTED;
      readonly rejectionReason: string;
    };

interface ApplicationStatusConflictExtensions extends ProblemDetailExtensions {
  readonly latestStatus: ApplicationStatus;
}

interface RepositoryEventConflictExtensions extends ProblemDetailExtensions {
  readonly eventId: string;
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(private readonly repository: ApplicationsRepository) {}

  async decide(
    actorId: string,
    applicationId: string,
    action: ApplicationDecisionAction,
  ): Promise<ApplicationDecisionResult> {
    const idempotencyKey = `repository-provision:${applicationId}`;
    try {
      return await this.repository.withTransaction(async (store) => {
        const application = await store.findApplicationById(applicationId);
        if (!application) {
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.APPLICATION_NOT_FOUND
            ],
          );
        }
        if (application.status !== ApplicationStatus.SUBMITTED) {
          const extensions: ApplicationStatusConflictExtensions = {
            latestStatus: application.status,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED
            ],
            extensions,
          );
        }

        let plan: ApplicationDecisionPlan;
        switch (action.action) {
          case APPLICATION_DECISION_ACTIONS.APPROVE:
            plan = {
              kind: 'APPROVE',
              status: ApplicationStatus.APPROVED,
              rejectionReason: null,
            };
            break;
          case APPLICATION_DECISION_ACTIONS.REJECT:
            plan = {
              kind: 'REJECT',
              status: ApplicationStatus.REJECTED,
              rejectionReason: action.reason,
            };
            break;
          default: {
            const exhaustiveAction: never = action;
            return exhaustiveAction;
          }
        }

        const processedAt = new Date();
        const transitioned = await store.transitionApplication({
          applicationId,
          expectedStatus: ApplicationStatus.SUBMITTED,
          nextStatus: plan.status,
          rejectionReason: plan.rejectionReason,
          processedById: actorId,
          processedAt,
        });
        if (!transitioned) {
          const latest = await store.findApplicationById(applicationId);
          const extensions: ApplicationStatusConflictExtensions = {
            latestStatus: latest?.status ?? application.status,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED
            ],
            extensions,
          );
        }

        switch (plan.kind) {
          case 'REJECT':
            return {
              kind: 'REJECTED',
              applicationId,
              status: plan.status,
              rejectionReason: plan.rejectionReason,
            };
          case 'APPROVE': {
            if (!application.repositoryProvisioningEnabled) {
              return {
                kind: 'APPROVED',
                applicationId,
                status: plan.status,
                repositoryProvisioning: {
                  enabled: false,
                  eventId: null,
                  jobStatus: null,
                },
              };
            }
            const event = await store.createRepositoryProvisionEvent({
              applicationId,
              programId: application.programId,
              teamId: application.teamId,
              collaboratorGithubLogins: application.collaboratorGithubLogins,
              idempotencyKey,
              requestedAt: processedAt,
            });
            return {
              kind: 'APPROVED',
              applicationId,
              status: plan.status,
              repositoryProvisioning: {
                enabled: true,
                eventId: event.id,
                jobStatus: RepositoryProvisionJobStatus.PENDING,
              },
            };
          }
          default: {
            const exhaustivePlan: never = plan;
            return exhaustivePlan;
          }
        }
      });
    } catch (error) {
      if (error instanceof DomainException) {
        throw error;
      }
      if (error instanceof RepositoryEventAlreadyExistsError) {
        const existing =
          await this.repository.findRepositoryProvisionEvent(idempotencyKey);
        if (existing) {
          const extensions: RepositoryEventConflictExtensions = {
            eventId: existing.id,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.REPOSITORY_EVENT_ALREADY_EXISTS
            ],
            extensions,
          );
        }
      }
      this.logger.error({
        event: 'applications.decision.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new DomainException(
        APPLICATIONS_ERROR_CODES[
          ApplicationsErrorCode.DECISION_TRANSACTION_FAILED
        ],
      );
    }
  }
}
