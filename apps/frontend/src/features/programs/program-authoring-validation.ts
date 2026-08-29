import type {
  ProgramAuthoringState,
  ProgramAuthoringStep,
} from './program-authoring-model';
import {
  validateMilestones,
  validateRequirements,
} from './program-authoring-graph-validation';
import {
  dateValue,
  issue,
  required,
  type ProgramAuthoringIssue,
} from './program-authoring-validation-helpers';

export type { ProgramAuthoringIssue } from './program-authoring-validation-helpers';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Map<string, readonly string[]>([
  ['.pdf', ['application/pdf']],
  [
    '.hwp',
    [
      'application/x-hwp',
      'application/haansofthwp',
      'application/vnd.hancom.hwp',
      'application/x-hwp-v5',
      'application/octet-stream',
    ],
  ],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.png', ['image/png']],
  ['.zip', ['application/zip']],
]);

export function validateProgramAuthoringStep(
  state: ProgramAuthoringState,
  step: ProgramAuthoringStep,
): readonly ProgramAuthoringIssue[] {
  switch (step) {
    case 'type':
      return [];
    case 'basic':
      return validateBasic(state);
    case 'schedule':
      return validateSchedule(state);
    case 'milestones':
      return [
        ...validateMilestones(state, 'milestones'),
        ...validateRequirements(state),
      ];
    case 'operations':
    case 'review':
      return [];
    default:
      return assertNever(step);
  }
}

export function validateProgramAuthoringManifest(
  state: ProgramAuthoringState,
): readonly ProgramAuthoringIssue[] {
  return [
    ...validateBasic(state),
    ...validateSchedule(state),
    ...validateMilestones(state, 'milestones'),
    ...validateRequirements(state),
  ];
}

export function validateTemplateFile(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) return '파일은 5MiB 이하여야 합니다.';
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
  const mimeTypes = ALLOWED_FILE_TYPES.get(extension);
  if (mimeTypes === undefined || !mimeTypes.includes(file.type.toLowerCase())) {
    return 'PDF, HWP, JPG, PNG, ZIP 파일만 선택할 수 있습니다.';
  }
  return null;
}

function validateBasic(
  state: ProgramAuthoringState,
): readonly ProgramAuthoringIssue[] {
  const issues: ProgramAuthoringIssue[] = [];
  required(issues, state.name, 'name', '프로그램명을 입력해 주세요.');
  required(issues, state.organizer, 'organizer', '주관기관을 입력해 주세요.');
  const minimum = Number(state.teamMinSize);
  const maximum = Number(state.teamMaxSize);
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > 100)
    issues.push(
      issue(
        'teamMinSize',
        'basic',
        '최소 팀 인원은 1명 이상 100명 이하여야 합니다.',
      ),
    );
  if (!Number.isInteger(maximum) || maximum > 100 || maximum < minimum)
    issues.push(
      issue(
        'teamMaxSize',
        'basic',
        '최대 팀 인원은 최소 이상 100명 이하여야 합니다.',
      ),
    );
  required(issues, state.description, 'description', '소개를 입력해 주세요.');
  return issues;
}

function validateSchedule(
  state: ProgramAuthoringState,
): readonly ProgramAuthoringIssue[] {
  const issues: ProgramAuthoringIssue[] = [];
  const applicationStart = dateValue(state.applicationStartAt);
  const applicationEnd = dateValue(state.applicationEndAt);
  const operationStart = dateValue(state.operationStartAt);
  const operationEnd = dateValue(state.operationEndAt);
  if (applicationStart === null)
    issues.push(
      issue('applicationStartAt', 'schedule', '신청 시작을 입력해 주세요.'),
    );
  if (
    applicationEnd === null ||
    (applicationStart !== null && applicationStart > applicationEnd)
  )
    issues.push(
      issue(
        'applicationEndAt',
        'schedule',
        '신청 종료는 신청 시작 이후여야 합니다.',
      ),
    );
  if (operationStart === null)
    issues.push(
      issue('operationStartAt', 'schedule', '운영 시작을 입력해 주세요.'),
    );
  if (
    operationEnd === null ||
    (operationStart !== null && operationStart >= operationEnd)
  )
    issues.push(
      issue(
        'operationEndAt',
        'schedule',
        '운영 종료는 운영 시작보다 늦어야 합니다.',
      ),
    );
  if (
    applicationEnd !== null &&
    operationEnd !== null &&
    applicationEnd > operationEnd
  )
    issues.push(
      issue(
        'applicationEndAt',
        'schedule',
        '신청 종료는 운영 종료 이전이어야 합니다.',
      ),
    );

  return issues;
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled authoring step: ${String(value)}`);
}
