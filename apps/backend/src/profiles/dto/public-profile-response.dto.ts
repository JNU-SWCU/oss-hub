import { ProgramCategory } from '@prisma/client';

export enum PublicProfileApplicationMode {
  PERSONAL = 'PERSONAL',
  TEAM = 'TEAM',
}

export interface PublicProfileRepositoryResponseDto {
  repositoryId: string;
  programId: string;
  programName: string;
  category: ProgramCategory;
  applicationMode: PublicProfileApplicationMode;
  displayName: string;
  repositoryName: string;
  githubUrl: string;
  publishedAt: string;
  detailUrl: string;
}

export interface PublicProfileResponseDto {
  userId: string;
  githubNickname: string;
  avatarUrl: string | null;
  repositories: PublicProfileRepositoryResponseDto[];
}
