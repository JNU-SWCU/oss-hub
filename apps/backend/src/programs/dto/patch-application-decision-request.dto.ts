import { IsOptional, IsString } from 'class-validator';
import { type ApplicationDecisionCommand } from '../team.repository';

export class PatchApplicationDecisionRequestDto implements ApplicationDecisionCommand {
  @IsString()
  declare readonly action: string;

  @IsOptional()
  @IsString()
  declare readonly reason?: string;
}
