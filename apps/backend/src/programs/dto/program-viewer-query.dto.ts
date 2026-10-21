import { IsIn, IsOptional } from 'class-validator';

export class ProgramViewerQueryRequestDto {
  @IsOptional()
  @IsIn(['operations'])
  view?: 'operations';
}
