export {
  PROGRAM_AUTHORING_STEPS,
  createInitialProgramAuthoringState,
  createMilestoneDraft,
  createRequirementDraft,
  programAuthoringReducer,
  type ProgramAuthoringAction,
  type ProgramAuthoringMilestone,
  type ProgramAuthoringRequirement,
  type ProgramAuthoringState,
  type ProgramAuthoringStep,
  type ProgramAuthoringTemplateFile,
} from './program-authoring-model';
export {
  buildProgramAuthoringManifest,
  seoulDateTimeToIso,
  seoulDateTimeSummary,
  type ProgramAuthoringManifest,
} from './program-authoring-manifest';
export {
  validateProgramAuthoringManifest,
  validateProgramAuthoringStep,
  validateTemplateFile,
  type ProgramAuthoringIssue,
} from './program-authoring-validation';

export const UNSAVED_PROGRAM_MESSAGE =
  '작성 중인 내용이 있습니다. 나가면 복구 정보가 삭제됩니다.';
