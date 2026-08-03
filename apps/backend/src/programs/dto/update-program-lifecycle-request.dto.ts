import { IsIn } from 'class-validator';
import { ProgramLifecycle } from '@prisma/client';

export class UpdateProgramLifecycleRequestDto {
  @IsIn([ProgramLifecycle.PUBLISHED, ProgramLifecycle.ARCHIVED])
  readonly lifecycle!: ProgramLifecycle;
}
