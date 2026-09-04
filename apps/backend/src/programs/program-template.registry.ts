import { ProgramCategory } from '@prisma/client';

export const PROGRAM_PARTICIPATION = {
  TEAM: 'TEAM',
} as const;

export type ProgramParticipation =
  (typeof PROGRAM_PARTICIPATION)[keyof typeof PROGRAM_PARTICIPATION];

export const APPLICATION_FIELD_TYPES = {
  AUTO: 'auto',
  TEXT: 'text',
  TEXTAREA: 'textarea',
} as const;

export type ApplicationFieldType =
  (typeof APPLICATION_FIELD_TYPES)[keyof typeof APPLICATION_FIELD_TYPES];

export type ApplicationFieldKey = 'applicantName' | 'summary';

export interface FieldDef {
  readonly key: ApplicationFieldKey;
  readonly type: ApplicationFieldType;
  readonly label: string;
  readonly required: boolean;
}

/** v1 신청 필드 — 7종 템플릿 공통. 서버가 SSOT다. */
export const V1_APPLICATION_FIELDS: readonly FieldDef[] = [
  {
    key: 'applicantName',
    type: APPLICATION_FIELD_TYPES.AUTO,
    label: '신청자',
    required: true,
  },
  {
    key: 'summary',
    type: APPLICATION_FIELD_TYPES.TEXTAREA,
    label: '요약',
    required: true,
  },
] as const;

export interface ProgramTemplate {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: ProgramParticipation;
  readonly teamSize: {
    readonly defaultMin: number;
    readonly defaultMax: number;
    readonly editable: boolean;
  };
  readonly fields: readonly FieldDef[];
}

function template(key: string, name: string): ProgramTemplate {
  return {
    key,
    version: 1,
    name,
    participation: PROGRAM_PARTICIPATION.TEAM,
    teamSize: { defaultMin: 1, defaultMax: 1, editable: true },
    fields: V1_APPLICATION_FIELDS,
  };
}

export const PROGRAM_TEMPLATES: Readonly<
  Record<ProgramCategory, ProgramTemplate>
> = {
  [ProgramCategory.BASIC]: template('basic', '기본 신청서'),
  [ProgramCategory.SW_VALUE_SPREAD]: template(
    'sw-value-spread',
    'SW가치확산 신청서',
  ),
  [ProgramCategory.OSS_CONTEST]: template('oss-contest', 'OSS경진대회 신청서'),
  [ProgramCategory.CAPSTONE]: template('capstone', '캡스톤 신청서'),
  [ProgramCategory.SW_CONVERGENCE]: template('sw-convergence', 'SW융합 신청서'),
  [ProgramCategory.GLOBAL_MAKERTHON]: template(
    'global-makerthon',
    '글로벌메이커톤 신청서',
  ),
  [ProgramCategory.CORPORATE_INTERNSHIP]: template(
    'corporate-internship',
    '기업인턴십 신청서',
  ),
};

export function getProgramTemplate(category: ProgramCategory): ProgramTemplate {
  return PROGRAM_TEMPLATES[category];
}

export function listProgramTemplates(): readonly ProgramTemplate[] {
  return Object.values(PROGRAM_TEMPLATES);
}

export function getTemplateByKey(key: string): ProgramTemplate | undefined {
  return listProgramTemplates().find((item) => item.key === key);
}
