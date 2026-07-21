import type { ApplicationFormTemplate } from './types';

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

export interface ProgramTemplateDefinition {
  readonly category: ProgramCategory;
  readonly label: string;
  readonly template: ApplicationFormTemplate;
}

export const PROGRAM_TEMPLATE_DEFINITIONS: readonly ProgramTemplateDefinition[] =
  [
    {
      category: 'BASIC',
      label: '기본',
      template: {
        key: 'basic',
        version: 1,
        name: '기본 신청서',
        participation: 'individual',
      },
    },
    {
      category: 'SW_VALUE_SPREAD',
      label: 'SW가치확산',
      template: {
        key: 'sw-value-spread',
        version: 1,
        name: 'SW가치확산 신청서',
        participation: 'individual',
      },
    },
    {
      category: 'OSS_CONTEST',
      label: 'OSS경진대회',
      template: {
        key: 'oss-contest',
        version: 1,
        name: 'OSS경진대회 신청서',
        participation: 'team',
      },
    },
    {
      category: 'CAPSTONE',
      label: '캡스톤',
      template: {
        key: 'capstone',
        version: 1,
        name: '캡스톤 신청서',
        participation: 'team',
      },
    },
    {
      category: 'SW_CONVERGENCE',
      label: 'SW융합',
      template: {
        key: 'sw-convergence',
        version: 1,
        name: 'SW융합 신청서',
        participation: 'team',
      },
    },
    {
      category: 'GLOBAL_MAKERTHON',
      label: '글로벌메이커톤',
      template: {
        key: 'global-makerthon',
        version: 1,
        name: '글로벌메이커톤 신청서',
        participation: 'team',
      },
    },
    {
      category: 'CORPORATE_INTERNSHIP',
      label: '기업인턴십',
      template: {
        key: 'corporate-internship',
        version: 1,
        name: '기업인턴십 신청서',
        participation: 'individual',
      },
    },
  ];
