import type { ProgramTrackType } from '@prisma/client';

export interface PublicProjectRow {
  readonly id: string;

  readonly projectId: string;
  readonly githubRepositoryId: bigint;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: Date;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: ProgramTrackType | null;
  readonly teamName: string | null;

  readonly teamMemberCount: number;
  readonly applicantNickname: string;
}

export interface PublicProjectCursor {
  readonly publishedAt: Date;
  readonly id: string;
}

export interface PublicUserIdentity {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;

  readonly githubId: bigint;
}
