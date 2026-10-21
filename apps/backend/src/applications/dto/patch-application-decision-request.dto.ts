import { IsOptional, IsString } from 'class-validator';
import type { ApplicationDecisionCommand } from '../domain/application-decision';

export class PatchApplicationDecisionRequestDto implements ApplicationDecisionCommand {
  @IsString()
  declare readonly action: string;

  @IsOptional()
  @IsString()
  declare readonly reason?: string;
}
