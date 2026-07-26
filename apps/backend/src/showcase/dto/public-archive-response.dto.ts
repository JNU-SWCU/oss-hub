import { ProgramCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum PublicArchiveApplicationMode {
  PERSONAL = 'PERSONAL',
  TEAM = 'TEAM',
}

export class PublicArchiveQueryRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly q: string = '';

  @IsOptional()
  @IsEnum(ProgramCategory)
  readonly category?: ProgramCategory;

  @IsOptional()
  @IsEnum(PublicArchiveApplicationMode)
  readonly applicationMode?: PublicArchiveApplicationMode;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  readonly pageSize: number = 20;
}

export interface PublicArchiveListItemResponseDto {
  repositoryId: string;
  programId: string;
  programName: string;
  category: ProgramCategory;
  applicationMode: PublicArchiveApplicationMode;
  displayName: string;
  githubUrl: string;
  publishedAt: string;
  detailUrl: string;
}

export interface PublicArchiveListResponseDto {
  items: PublicArchiveListItemResponseDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PublicArchiveContributorResponseDto {
  userId: string;
  githubNickname: string;
  avatarUrl: string | null;
}

export interface PublicArchiveDetailResponseDto {
  repositoryId: string;
  programId: string;
  programName: string;
  category: ProgramCategory;
  applicationMode: PublicArchiveApplicationMode;
  displayName: string;
  repositoryName: string;
  githubUrl: string;
  publishedAt: string;
  approvedSubmissionCount: number;
  contributors: PublicArchiveContributorResponseDto[];
}
