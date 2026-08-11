import type {
  ProgramAuthoringMilestone,
  ProgramAuthoringRequirement,
  ProgramAuthoringState,
} from './program-authoring-model';
import {
  dateValue,
  issue,
  required,
  type ProgramAuthoringIssue,
} from './program-authoring-validation-helpers';

const MAX_MILESTONES = 50;
const MAX_REQUIREMENTS_PER_MILESTONE = 20;
const MAX_REQUIREMENTS = 100;

export function validateMilestones(
  state: ProgramAuthoringState,
): readonly ProgramAuthoringIssue[] {
  const issues: ProgramAuthoringIssue[] = [];
  if (state.milestones.length === 0)
    issues.push(
      issue('milestones', 'milestones', '마일스톤을 1개 이상 추가해 주세요.'),
    );
  if (state.milestones.length > MAX_MILESTONES)
    issues.push(
      issue(
        'milestones',
        'milestones',
        '마일스톤은 최대 50개까지 추가할 수 있습니다.',
      ),
    );
  for (const milestone of state.milestones) {
    validateMilestone(state, milestone, issues);
  }
  return issues;
}

function validateMilestone(
  state: ProgramAuthoringState,
  milestone: ProgramAuthoringMilestone,
  issues: ProgramAuthoringIssue[],
): void {
  const prefix = `milestones.${milestone.id}`;
  required(
    issues,
    milestone.name,
    `${prefix}.name`,
    '마일스톤명을 입력해 주세요.',
    'milestones',
  );
  const operationStart = dateValue(state.operationStartAt);
  const operationEnd = dateValue(state.operationEndAt);
  const start = dateValue(milestone.startAt);
  const due = dateValue(milestone.dueAt);
  if (start === null || (operationStart !== null && start < operationStart))
    issues.push(
      issue(
        `${prefix}.startAt`,
        'milestones',
        '시작은 프로그램 운영 시작 이후여야 합니다.',
      ),
    );
  if (
    due === null ||
    (start !== null && start >= due) ||
    (operationEnd !== null && due >= operationEnd)
  )
    issues.push(
      issue(
        `${prefix}.dueAt`,
        'milestones',
        '마감은 시작보다 늦고 운영 종료보다 빨라야 합니다.',
      ),
    );
}

export function validateRequirements(
  state: ProgramAuthoringState,
): readonly ProgramAuthoringIssue[] {
  const issues: ProgramAuthoringIssue[] = [];
  let total = 0;
  for (const milestone of state.milestones) {
    total += milestone.requirements.length;
    if (milestone.requirements.length > MAX_REQUIREMENTS_PER_MILESTONE) {
      issues.push(
        issue(
          `requirements.${milestone.id}`,
          'milestones',
          '마일스톤마다 요구서류는 최대 20개입니다.',
        ),
      );
    }
    for (const requirement of milestone.requirements) {
      validateRequirement(requirement, issues);
    }
  }
  if (total > MAX_REQUIREMENTS)
    issues.push(
      issue('requirements', 'milestones', '전체 요구서류는 최대 100개입니다.'),
    );
  return issues;
}

function validateRequirement(
  requirement: ProgramAuthoringRequirement,
  issues: ProgramAuthoringIssue[],
): void {
  const prefix = `requirements.${requirement.id}`;
  required(
    issues,
    requirement.name,
    `${prefix}.name`,
    '요구서류명을 입력해 주세요.',
    'milestones',
  );
  if (
    requirement.submissionType === 'TEXT' &&
    requirement.templateFile !== null
  ) {
    issues.push(
      issue(
        `${prefix}.templateFile`,
        'milestones',
        '텍스트 제출에는 양식을 첨부할 수 없습니다.',
      ),
    );
  }
  if (requirement.templateFile?.requiresReselection === true) {
    issues.push(
      issue(`${prefix}.templateFile`, 'milestones', '파일 재선택 필요'),
    );
  }
}
