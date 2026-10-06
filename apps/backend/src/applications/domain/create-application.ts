export type CreateApplicationAnswersInput = Readonly<Record<string, unknown>>;

export interface CreateApplicationInput {
  readonly answers: CreateApplicationAnswersInput;

  readonly teamName: string | null;
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned: boolean;
}
