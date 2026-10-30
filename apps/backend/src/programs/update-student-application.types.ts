export interface UpdateStudentApplicationInput {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly applicationTemplateVersion: number;
}
