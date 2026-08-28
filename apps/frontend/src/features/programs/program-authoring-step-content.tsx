import { deleteAuthoringUpload } from './program-authoring-api';
import {
  ProgramAuthoringBasicStep,
  ProgramAuthoringScheduleStep,
  ProgramAuthoringTypeStep,
} from './program-authoring-detail-steps';
import {
  ProgramAuthoringOperationsStep,
  ProgramAuthoringReviewStep,
} from './program-authoring-final-steps';
import { ProgramAuthoringMilestoneStep } from './program-authoring-milestone-step';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
  ProgramAuthoringStep,
} from './program-authoring-model';
import type { ProgramSubmissionRuntime } from './program-authoring-submit';
import type { ProgramAuthoringIssue } from './program-authoring-validation';

type ProgramAuthoringStepContentProps = {
  readonly step: ProgramAuthoringStep;
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
  readonly files: Map<string, File>;
  readonly runtime: ProgramSubmissionRuntime;
  readonly newId: () => string;
};

export function ProgramAuthoringStepContent({
  step,
  state,
  issues,
  dispatch,
  files,
  runtime,
  newId,
}: ProgramAuthoringStepContentProps) {
  const shared = { state, issues, dispatch };
  const removeMilestone = (milestoneId: string) => {
    const milestone = state.milestones.find(
      (candidate) => candidate.id === milestoneId,
    );
    for (const requirement of milestone?.requirements ?? []) {
      files.delete(requirement.id);
      discardCachedUpload(runtime, requirement.id);
    }
    dispatch({ type: 'remove_milestone', milestoneId });
  };
  switch (step) {
    case 'type':
      return <ProgramAuthoringTypeStep {...shared} />;
    case 'basic':
      return <ProgramAuthoringBasicStep {...shared} />;
    case 'schedule':
      return (
        <ProgramAuthoringScheduleStep
          {...shared}
          newId={newId}
          onMilestoneRemove={removeMilestone}
        />
      );
    case 'milestones':
      return (
        <ProgramAuthoringMilestoneStep
          {...shared}
          newId={newId}
          onRemove={removeMilestone}
          onRequirementFileChange={(milestoneId, requirementId, file) => {
            discardCachedUpload(runtime, requirementId);
            if (file === null) files.delete(requirementId);
            else files.set(requirementId, file);
            dispatch({
              type: 'set_requirement_file',
              milestoneId,
              requirementId,
              file:
                file === null
                  ? null
                  : { name: file.name, size: file.size, type: file.type },
            });
          }}
          onRequirementRemove={(milestoneId, requirementId) => {
            files.delete(requirementId);
            discardCachedUpload(runtime, requirementId);
            dispatch({
              type: 'remove_requirement',
              milestoneId,
              requirementId,
            });
          }}
        />
      );
    case 'operations':
      return <ProgramAuthoringOperationsStep {...shared} />;
    case 'review':
      return <ProgramAuthoringReviewStep state={state} />;
    default:
      return assertNever(step);
  }
}

function discardCachedUpload(
  runtime: ProgramSubmissionRuntime,
  requirementId: string,
): void {
  const upload = runtime.uploads.get(requirementId);
  if (upload === undefined) return;
  runtime.uploads.delete(requirementId);
  void Promise.allSettled([deleteAuthoringUpload(upload.id)]);
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled authoring step: ${String(value)}`);
}
