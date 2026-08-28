import { messageFor } from './program-authoring-fields';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import type { ProgramAuthoringIssue } from './program-authoring-validation';
import { dateKey } from './program-schedule-calendar-model';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';

export function issueScheduleRangeId(
  issues: readonly ProgramAuthoringIssue[],
): string | null {
  for (const issue of issues) {
    if (
      issue.path === 'applicationStartAt' ||
      issue.path === 'applicationEndAt'
    )
      return 'application';
    if (issue.path === 'operationStartAt' || issue.path === 'operationEndAt')
      return 'operation';
    const milestoneId = /^milestones\.([^.]+)\.(?:startAt|dueAt)$/.exec(
      issue.path,
    )?.[1];
    if (milestoneId !== undefined) return milestoneId;
  }
  return null;
}

export function authoringScheduleRanges(
  state: ProgramAuthoringState,
  issues: readonly ProgramAuthoringIssue[],
  dispatch: (action: ProgramAuthoringAction) => void,
): readonly ProgramScheduleEditableRange[] {
  const programRange = (
    id: 'application' | 'operation',
    label: string,
    kind: 'APPLICATION' | 'OPERATION',
    startField: 'applicationStartAt' | 'operationStartAt',
    endField: 'applicationEndAt' | 'operationEndAt',
  ): ProgramScheduleEditableRange => ({
    id,
    label,
    kind,
    startAt: state[startField],
    endAt: state[endField],
    minDate:
      id === 'operation'
        ? (dateKey(state.applicationEndAt) ?? undefined)
        : undefined,
    startInputId: `${id}-start`,
    endInputId: `${id}-end`,
    startError: messageFor(issues, startField),
    endError: messageFor(issues, endField),
    onStartAtChange: (value) =>
      dispatch({ type: 'set_program_field', field: startField, value }),
    onEndAtChange: (value) =>
      dispatch({ type: 'set_program_field', field: endField, value }),
  });
  const operationStart = dateKey(state.operationStartAt) ?? undefined;
  const operationEnd = dateKey(state.operationEndAt) ?? undefined;

  return [
    programRange(
      'application',
      '신청 기간',
      'APPLICATION',
      'applicationStartAt',
      'applicationEndAt',
    ),
    programRange(
      'operation',
      '운영 기간',
      'OPERATION',
      'operationStartAt',
      'operationEndAt',
    ),
    ...state.milestones.map((milestone, index) => {
      const prefix = `milestones.${milestone.id}`;
      return {
        id: milestone.id,
        label: milestone.name || `마일스톤 ${index + 1}`,
        kind: 'MILESTONE' as const,
        startAt: milestone.startAt,
        endAt: milestone.dueAt,
        minDate: operationStart,
        maxDate: operationEnd,
        startInputId: `${milestone.id}-start`,
        endInputId: `${milestone.id}-due`,
        startError: messageFor(issues, `${prefix}.startAt`),
        endError: messageFor(issues, `${prefix}.dueAt`),
        onStartAtChange: (value: string) =>
          dispatch({
            type: 'set_milestone_field',
            milestoneId: milestone.id,
            field: 'startAt',
            value,
          }),
        onEndAtChange: (value: string) =>
          dispatch({
            type: 'set_milestone_field',
            milestoneId: milestone.id,
            field: 'dueAt',
            value,
          }),
      };
    }),
  ];
}
