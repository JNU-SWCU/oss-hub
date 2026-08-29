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
    minDate: undefined,
    maxDate:
      id === 'application'
        ? (dateKey(state.operationEndAt) ?? undefined)
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
  ];
}
