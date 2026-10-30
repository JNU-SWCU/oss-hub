import { IsIn, IsOptional } from 'class-validator';

export class ProgramViewerRequestDto {
  @IsOptional()
  @IsIn(['operations'])
  view?: 'operations';
}
