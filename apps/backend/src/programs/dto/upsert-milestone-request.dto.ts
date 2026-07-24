import { MilestoneSubmissionType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertMilestoneRequestDto {
  @IsString()
  @IsNotEmpty()
  declare name: string;

  @IsString()
  declare dueAt: string;

  @IsEnum(MilestoneSubmissionType)
  declare submissionType: MilestoneSubmissionType;

  @IsOptional()
  @IsString()
  declare instructions?: string | null;
}
