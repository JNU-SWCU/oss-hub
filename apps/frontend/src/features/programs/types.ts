export const PROGRAM_PARTICIPATION_TYPES = ['individual', 'team'] as const;

export type ProgramParticipation =
  (typeof PROGRAM_PARTICIPATION_TYPES)[number];

export const APPLICATION_FIELD_INPUT_TYPES = ['text', 'url', 'textarea'] as const;

export type ApplicationFieldInputType =
  (typeof APPLICATION_FIELD_INPUT_TYPES)[number];

export interface ApplicationFormField {
  readonly key: string;
  readonly label: string;
  readonly inputType: ApplicationFieldInputType;
  readonly required: boolean;
}

export interface ApplicationFormTemplate {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: ProgramParticipation;
  readonly fields: readonly ApplicationFormField[];
}
