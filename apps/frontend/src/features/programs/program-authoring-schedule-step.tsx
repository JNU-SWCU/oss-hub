'use client';

import { useState } from 'react';
import { FormSection } from '@/components/form-section';
import { ProgramScheduleRangeEditor } from './program-schedule-range-editor';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import type { ProgramAuthoringIssue } from './program-authoring-validation';
import {
  authoringScheduleRanges,
  issueScheduleRangeId,
} from './program-authoring-schedule-ranges';

type ScheduleStepProps = {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
};

export function ProgramAuthoringScheduleStep({
  state,
  issues,
  dispatch,
}: ScheduleStepProps) {
  const [activeId, setActiveId] = useState('application');
  const issueActiveId = issueScheduleRangeId(issues);
  const ranges = authoringScheduleRanges(state, issues, dispatch);

  return (
    <FormSection
      title="신청 · 운영 일정"
      description="달력에서 시작일과 종료일을 차례로 선택하세요."
    >
      <ProgramScheduleRangeEditor
        ranges={ranges}
        activeId={activeId}
        validationActiveId={issueActiveId}
        onActiveIdChange={setActiveId}
        layout="simple"
      />
    </FormSection>
  );
}
