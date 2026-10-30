import { IsIn, IsOptional } from 'class-validator';

export class ProgramOverviewQueryRequestDto {
  @IsOptional()
  @IsIn(['operations'])
  view?: 'operations';
}
