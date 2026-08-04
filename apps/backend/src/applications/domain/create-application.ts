import type { RepositoryConnectionMode } from '@prisma/client';

export type CreateApplicationAnswersInput = Readonly<Record<string, unknown>>;

export interface CreateApplicationInput {
  readonly answers: CreateApplicationAnswersInput;
  /** 미입력·공백이면 신청자 표시명 기반 기본값을 쓴다. */
  readonly teamName: string | null;
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
}
