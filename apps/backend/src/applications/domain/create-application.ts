export type CreateApplicationAnswersInput = Readonly<Record<string, unknown>>;

export interface CreateApplicationInput {
  readonly answers: CreateApplicationAnswersInput;
  readonly teamId: string | null;
  readonly applicationTemplateVersion: number;
}
