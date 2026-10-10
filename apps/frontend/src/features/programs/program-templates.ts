import type {
  ApplicationFormField,
  ApplicationFormTemplate,
  ProgramDetail,
} from './types';

type ProgramCategory =
  | 'BASIC'
  | 'SW_VALUE_SPREAD'
  | 'OSS_CONTEST'
  | 'CAPSTONE'
  | 'SW_CONVERGENCE'
  | 'GLOBAL_MAKERTHON'
  | 'CORPORATE_INTERNSHIP';

export const PROGRAM_TRACK_TYPES = ['CURRICULAR', 'EXTRACURRICULAR'] as const;

export type ProgramTrackType = (typeof PROGRAM_TRACK_TYPES)[number];

export const PROGRAM_TRACK_TYPE_LABELS = {
  CURRICULAR: '교과',
  EXTRACURRICULAR: '비교과',
} as const satisfies Record<ProgramTrackType, string>;

export const V1_APPLICATION_FIELDS: readonly ApplicationFormField[] = [
  { key: 'applicantName', type: 'auto', label: '신청자', required: true },
];

export interface ProgramTemplateDefinition {
  readonly category: ProgramCategory;
  readonly label: string;
  readonly template: ApplicationFormTemplate;
}

function definition(
  category: ProgramCategory,
  label: string,
  key: string,
  name: string,
): ProgramTemplateDefinition {
  return {
    category,
    label,
    template: {
      key,
      version: 1,
      name,
      participation: 'team',
      fields: V1_APPLICATION_FIELDS,
    },
  };
}

export const PROGRAM_TEMPLATE_DEFINITIONS: readonly ProgramTemplateDefinition[] =
  [
    definition('BASIC', '기본', 'basic', '기본 신청서'),
    definition(
      'SW_VALUE_SPREAD',
      'SW가치확산',
      'sw-value-spread',
      'SW가치확산 신청서',
    ),
    definition(
      'OSS_CONTEST',
      'OSS경진대회',
      'oss-contest',
      'OSS경진대회 신청서',
    ),
    definition('CAPSTONE', '캡스톤', 'capstone', '캡스톤 신청서'),
    definition('SW_CONVERGENCE', 'SW융합', 'sw-convergence', 'SW융합 신청서'),
    definition(
      'GLOBAL_MAKERTHON',
      '글로벌메이커톤',
      'global-makerthon',
      '글로벌메이커톤 신청서',
    ),
    definition(
      'CORPORATE_INTERNSHIP',
      '기업인턴십',
      'corporate-internship',
      '기업인턴십 신청서',
    ),
  ];

export function resolveProgramApplicationTemplate(
  program: Pick<ProgramDetail, 'applicationTemplateKey'>,
  templates: readonly ApplicationFormTemplate[],
): ApplicationFormTemplate | null {
  const fromApi = templates.find(
    (item) => item.key === program.applicationTemplateKey,
  );
  if (fromApi) return fromApi;
  return (
    PROGRAM_TEMPLATE_DEFINITIONS.find(
      (item) => item.template.key === program.applicationTemplateKey,
    )?.template ?? null
  );
}
