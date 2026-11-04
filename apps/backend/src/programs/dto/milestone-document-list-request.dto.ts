import { IsIn, IsOptional } from 'class-validator';

export class MilestoneDocumentListRequestDto {
  @IsOptional()
  @IsIn(['all'])
  declare readonly scope?: 'all';
}
