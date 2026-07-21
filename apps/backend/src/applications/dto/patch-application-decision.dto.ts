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

export class PatchApplicationDecisionDto {
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
      default:
        throw new DomainException(
          APPLICATIONS_ERROR_CODES[
            ApplicationsErrorCode.INVALID_DECISION_ACTION
          ],
        );
    }
  }
}
