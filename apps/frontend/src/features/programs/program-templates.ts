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

const personalFields = [
  {
    key: 'motivation',
    label: '참여 동기',
    inputType: 'textarea',
    required: true,
  },
  {
    key: 'portfolioUrl',
    label: '포트폴리오 URL',
    inputType: 'url',
    required: false,
  },
] as const;

const teamFields = [
  {
    key: 'projectName',
    label: '프로젝트명',
    inputType: 'text',
    required: true,
  },
  {
    key: 'projectSummary',
    label: '프로젝트 요약',
    inputType: 'textarea',
    required: true,
  },
] as const;

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
        fields: personalFields,
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
        fields: personalFields,
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
        fields: teamFields,
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
        fields: teamFields,
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
        fields: teamFields,
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
        fields: teamFields,
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
        fields: personalFields,
      },
    },
  ];
