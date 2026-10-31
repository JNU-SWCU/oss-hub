import { Injectable } from '@nestjs/common';
import { ApplicationStatus, ProgramCategory } from '@prisma/client';

export const PROGRAM_PARTICIPATION = {
  TEAM: 'TEAM',
} as const;

const APPLICATION_FIELD_TYPES = {
  AUTO: 'auto',
  TEXT: 'text',
  TEXTAREA: 'textarea',
} as const;

@Injectable()
export class ProgramRulesService {
  programDeadline(
    dueAt: Date,
    now: Date,
  ): {
    readonly dDay: number;
    readonly label: string;
  } {
    const dDay = calendarDayNumber(dueAt) - calendarDayNumber(now);
    const label =
      dDay < 0 ? '마감 지남' : dDay === 0 ? '오늘 마감' : `D-${dDay}`;
    return { dDay, label };
  }

  hasProgramDeadlinePassed(dueAt: Date, now: Date): boolean {
    return now.getTime() > dueAt.getTime();
  }

  isProgramEndAtUndecided(value: Date): boolean {
    return value.getTime() === PROGRAM_END_AT_UNDECIDED_TIME;
  }

  getProgramTemplate(category: ProgramCategory): ProgramTemplate {
    return PROGRAM_TEMPLATES[category];
  }

  listProgramTemplates(): readonly ProgramTemplate[] {
    return Object.values(PROGRAM_TEMPLATES);
  }

  getTemplateByKey(key: string): ProgramTemplate | undefined {
    return this.listProgramTemplates().find((item) => item.key === key);
  }

  canEditStudentRepositoryUrl(
    context: {
      readonly status: ApplicationStatus;
      readonly endAt: Date;
      readonly isManager: boolean;
    },
    now: Date,
  ): boolean {
    return (
      context.isManager &&
      context.status === ApplicationStatus.APPROVED &&
      now < context.endAt
    );
  }
}

const SEOUL_TIME_ZONE = 'Asia/Seoul';

function calendarDayNumber(value: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

const PROGRAM_END_AT_UNDECIDED_TIME = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export const V1_APPLICATION_FIELDS: readonly FieldDef[] = [
  {
    key: 'applicantName',
    type: APPLICATION_FIELD_TYPES.AUTO,
    label: '신청자',
    required: true,
  },
] as const;

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

const PROGRAM_TEMPLATES: Readonly<Record<ProgramCategory, ProgramTemplate>> = {
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

export type ProgramParticipation =
  (typeof PROGRAM_PARTICIPATION)[keyof typeof PROGRAM_PARTICIPATION];

type ApplicationFieldType =
  (typeof APPLICATION_FIELD_TYPES)[keyof typeof APPLICATION_FIELD_TYPES];

type ApplicationFieldKey = 'applicantName';

export interface FieldDef {
  readonly key: ApplicationFieldKey;
  readonly type: ApplicationFieldType;
  readonly label: string;
  readonly required: boolean;
}
