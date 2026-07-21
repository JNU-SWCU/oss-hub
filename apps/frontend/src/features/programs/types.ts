export const PROGRAM_PARTICIPATION_TYPES = ['individual', 'team'] as const;

export type ProgramParticipation = (typeof PROGRAM_PARTICIPATION_TYPES)[number];

export interface ApplicationFormTemplate {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: ProgramParticipation;
}
