import { IsOptional, IsString } from 'class-validator';
import { applicationDecisionAction } from '../domain/application-decision';
import type {
  ApplicationDecisionAction,
  ApplicationDecisionCommand,
} from '../domain/application-decision';

export class PatchApplicationDecisionRequestDto implements ApplicationDecisionCommand {
  @IsString()
  declare readonly action: string;

  @IsOptional()
  @IsString()
  declare readonly reason?: string;

  toAction(): ApplicationDecisionAction {
    return applicationDecisionAction(this);
  }
}
