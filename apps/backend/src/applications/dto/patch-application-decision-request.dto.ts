import { IsOptional, IsString } from 'class-validator';
import { DomainException } from '../../common/error-code';
import {
  APPLICATION_DECISION_ACTIONS,
  type ApplicationDecisionAction,
} from '../domain/application-decision';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from '../applications-error-code.enum';

export class PatchApplicationDecisionRequestDto {
  @IsString()
  declare readonly action: string;

  @IsOptional()
  @IsString()
  declare readonly reason?: string;

  toAction(): ApplicationDecisionAction {
    switch (this.action) {
      case APPLICATION_DECISION_ACTIONS.APPROVE:
        return { action: APPLICATION_DECISION_ACTIONS.APPROVE };
      case APPLICATION_DECISION_ACTIONS.REJECT: {
        const reason = this.reason?.trim();
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
          APPLICATIONS_ERROR_CODES[
            ApplicationsErrorCode.INVALID_DECISION_ACTION
          ],
        );
    }
  }
}
