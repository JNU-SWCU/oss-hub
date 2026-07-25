import type { ApplicationFormField, ApplicationFormTemplate } from './types';

export const PROGRAM_CATEGORIES = [
  'BASIC',
  'SW_VALUE_SPREAD',
  'OSS_CONTEST',
  'CAPSTONE',
  'SW_CONVERGENCE',
  'GLOBAL_MAKERTHON',
  'CORPORATE_INTERNSHIP',
] as const;

export type ProgramCategory = (typeof PROGRAM_CATEGORIES)[number];

/** 서버 V1_APPLICATION_FIELDS와 동일 계약. 목록 API 병합 전 로컬 폴백. */
export const V1_APPLICATION_FIELDS: readonly ApplicationFormField[] = [
  {
    key: 'applicantName',
    type: 'auto',
    label: '신청자',
    required: true,
  },
  {
    key: 'title',
    type: 'text',
    label: '제목',
    required: true,
  },
  {
    key: 'summary',
    type: 'textarea',
    label: '요약',
    required: true,
  },
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
  participation: ApplicationFormTemplate['participation'],
): ProgramTemplateDefinition {
  return {
    category,
    label,
    template: {
      key,
      version: 1,
      name,
      participation,
      fields: V1_APPLICATION_FIELDS,
    },
  };
}

export const PROGRAM_TEMPLATE_DEFINITIONS: readonly ProgramTemplateDefinition[] =
  [
    definition('BASIC', '기본', 'basic', '기본 신청서', 'individual'),
    definition(
      'SW_VALUE_SPREAD',
      'SW가치확산',
      'sw-value-spread',
      'SW가치확산 신청서',
      'individual',
    ),
    definition(
      'OSS_CONTEST',
      'OSS경진대회',
      'oss-contest',
      'OSS경진대회 신청서',
      'team',
    ),
    definition('CAPSTONE', '캡스톤', 'capstone', '캡스톤 신청서', 'team'),
    definition(
      'SW_CONVERGENCE',
      'SW융합',
      'sw-convergence',
      'SW융합 신청서',
      'team',
    ),
    definition(
      'GLOBAL_MAKERTHON',
      '글로벌메이커톤',
      'global-makerthon',
      '글로벌메이커톤 신청서',
      'team',
    ),
    definition(
      'CORPORATE_INTERNSHIP',
      '기업인턴십',
      'corporate-internship',
      '기업인턴십 신청서',
      'individual',
    ),
  ];

/** API 템플릿 fields를 카테고리 라벨 정의에 병합한다 (서버 fields SSOT). */
export function mergeTemplateFieldsFromApi(
  definitions: readonly ProgramTemplateDefinition[],
  apiTemplates: readonly ApplicationFormTemplate[],
): readonly ProgramTemplateDefinition[] {
  const byKey = new Map(apiTemplates.map((item) => [item.key, item]));
  return definitions.map((definition) => {
    const fromApi = byKey.get(definition.template.key);
    if (!fromApi) return definition;
    return {
      ...definition,
      template: {
        key: fromApi.key,
        version: fromApi.version,
        name: fromApi.name,
        participation: fromApi.participation,
        fields: fromApi.fields,
      },
    };
  });
}
