import { ProgramCategory } from '@prisma/client';

export const PROGRAM_PARTICIPATION = {
  INDIVIDUAL: 'INDIVIDUAL',
  TEAM: 'TEAM',
} as const;

export type ProgramParticipation =
  (typeof PROGRAM_PARTICIPATION)[keyof typeof PROGRAM_PARTICIPATION];

export interface ProgramTemplate {
  readonly key: string;
  readonly version: number;
  readonly participation: ProgramParticipation;
}

export const PROGRAM_TEMPLATES: Readonly<
  Record<ProgramCategory, ProgramTemplate>
> = {
  [ProgramCategory.BASIC]: {
    key: 'basic',
    version: 1,
    participation: PROGRAM_PARTICIPATION.INDIVIDUAL,
  },
  [ProgramCategory.SW_VALUE_SPREAD]: {
    key: 'sw-value-spread',
    version: 1,
    participation: PROGRAM_PARTICIPATION.INDIVIDUAL,
  },
  [ProgramCategory.OSS_CONTEST]: {
    key: 'oss-contest',
    version: 1,
    participation: PROGRAM_PARTICIPATION.TEAM,
  },
  [ProgramCategory.CAPSTONE]: {
    key: 'capstone',
    version: 1,
    participation: PROGRAM_PARTICIPATION.TEAM,
  },
  [ProgramCategory.SW_CONVERGENCE]: {
    key: 'sw-convergence',
    version: 1,
    participation: PROGRAM_PARTICIPATION.TEAM,
  },
  [ProgramCategory.GLOBAL_MAKERTHON]: {
    key: 'global-makerthon',
    version: 1,
    participation: PROGRAM_PARTICIPATION.TEAM,
  },
  [ProgramCategory.CORPORATE_INTERNSHIP]: {
    key: 'corporate-internship',
    version: 1,
    participation: PROGRAM_PARTICIPATION.INDIVIDUAL,
  },
};

export function getProgramTemplate(category: ProgramCategory): ProgramTemplate {
  return PROGRAM_TEMPLATES[category];
}
