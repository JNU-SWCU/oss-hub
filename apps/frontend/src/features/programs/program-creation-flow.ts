export {
  PROGRAM_AUTHORING_STEPS,
  createInitialProgramAuthoringState,
  createRequirementDraft,
  programAuthoringReducer,
  type ProgramAuthoringState,
} from './program-authoring-model';
export {
  buildProgramAuthoringManifest,
  seoulDateTimeToIso,
} from './program-authoring-manifest';
export {
  validateProgramAuthoringManifest,
  validateProgramAuthoringStep,
  validateTemplateFile,
} from './program-authoring-validation';

export const UNSAVED_PROGRAM_MESSAGE =
  '작성 중인 내용이 있습니다. 나가면 복구 정보가 삭제됩니다.';
