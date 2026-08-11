import type { ProgramCategory } from './program-templates';
import type { SubmissionType } from './types';
import type { ProgramAuthoringState } from './program-authoring-model';

export type ProgramAuthoringManifest = {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
  readonly milestones: readonly {
    readonly name: string;
    readonly startAt: string;
    readonly dueAt: string;
    readonly submissionType: SubmissionType;
    readonly instructions: string | null;
    readonly documents: readonly {
      readonly name: string;
      readonly required: boolean;
      readonly submissionType: SubmissionType;
      readonly templateUploadId?: string;
    }[];
  }[];
};

const SEOUL_SUMMARY = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function seoulDateTimeToIso(value: string): string {
  return new Date(`${value}:00+09:00`).toISOString();
}

export function seoulDateTimeSummary(value: string): string {
  return SEOUL_SUMMARY.format(new Date(seoulDateTimeToIso(value)));
}

export function buildProgramAuthoringManifest(
  state: ProgramAuthoringState,
  uploadIds: ReadonlyMap<string, string>,
): ProgramAuthoringManifest {
  return {
    name: state.name.trim(),
    organizer: state.organizer.trim(),
    category: state.category,
    applicationStartAt: seoulDateTimeToIso(state.applicationStartAt),
    applicationEndAt: seoulDateTimeToIso(state.applicationEndAt),
    startAt: seoulDateTimeToIso(state.operationStartAt),
    endAt: seoulDateTimeToIso(state.operationEndAt),
    teamMinSize: Number(state.teamMinSize),
    teamMaxSize: Number(state.teamMaxSize),
    repositoryProvisioningEnabled: state.repositoryProvisioningEnabled,
    notifyOnDeadline: state.notifyOnDeadline,
    description: state.description.trim(),
    milestones: state.milestones.map((milestone) => ({
      name: milestone.name.trim(),
      startAt: seoulDateTimeToIso(milestone.startAt),
      dueAt: seoulDateTimeToIso(milestone.dueAt),
      submissionType: milestone.submissionType,
      instructions: milestone.instructions.trim() || null,
      documents: milestone.requirements.map((requirement) => {
        const uploadId = uploadIds.get(requirement.id);
        return {
          name: requirement.name.trim(),
          required: requirement.required,
          submissionType: requirement.submissionType,
          ...(uploadId === undefined ? {} : { templateUploadId: uploadId }),
        };
      }),
    })),
  };
}
