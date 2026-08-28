'use client';

import { CalendarPlus2 } from 'lucide-react';
import { useState } from 'react';
import { FormSection } from '@/components/form-section';
import { Button } from '@/components/ui/button';
import { ProgramScheduleRangeEditor } from './program-schedule-range-editor';
import {
  ProgramAuthoringMilestoneDetails,
  ProgramAuthoringTeamSizeFields,
} from './program-authoring-schedule-fields';
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
  readonly newId: () => string;
  readonly onMilestoneRemove: (milestoneId: string) => void;
};

export function ProgramAuthoringScheduleStep({
  state,
  issues,
  dispatch,
  newId,
  onMilestoneRemove,
}: ScheduleStepProps) {
  const [activeId, setActiveId] = useState('application');
  const issueActiveId = issueScheduleRangeId(issues);
  const visibleActiveId = issueActiveId ?? activeId;
  const ranges = authoringScheduleRanges(state, issues, dispatch);
  const activeMilestone = state.milestones.find(
    (milestone) => milestone.id === visibleActiveId,
  );

  function addMilestone() {
    const milestoneId = newId();
    dispatch({ type: 'add_milestone', milestoneId });
    setActiveId(milestoneId);
  }

  function removeMilestone(milestoneId: string) {
    setActiveId('application');
    onMilestoneRemove(milestoneId);
  }

  return (
    <FormSection
      title="신청/운영 일정"
      description="같은 달력에서 신청, 운영, 마일스톤 기간을 비교하며 정합니다. 모든 시각은 Asia/Seoul 기준입니다."
    >
      <ProgramScheduleRangeEditor
        ranges={ranges}
        activeId={visibleActiveId}
        onActiveIdChange={setActiveId}
        headerAction={
          <Button
            type="button"
            variant="outline"
            className="mt-2 justify-self-end"
            disabled={state.milestones.length >= 50}
            onClick={addMilestone}
          >
            <CalendarPlus2 aria-hidden="true" />
            마일스톤 추가
          </Button>
        }
        activeExtra={
          activeMilestone ? (
            <ProgramAuthoringMilestoneDetails
              milestoneId={activeMilestone.id}
              name={activeMilestone.name}
              index={state.milestones.indexOf(activeMilestone)}
              issues={issues}
              dispatch={dispatch}
              canRemove={state.milestones.length > 1}
              onRemove={removeMilestone}
            />
          ) : null
        }
      />
      <ProgramAuthoringTeamSizeFields
        state={state}
        issues={issues}
        dispatch={dispatch}
      />
    </FormSection>
  );
}
