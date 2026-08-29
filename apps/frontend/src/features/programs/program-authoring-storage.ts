export const PROGRAM_AUTHORING_RECOVERY_KEY =
  'oss-hub:program-authoring:recovery-key';
const LEGACY_PROGRAM_AUTHORING_DRAFT_KEY = 'oss-hub:program-authoring';

export interface ProgramAuthoringStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export function persistProgramAuthoringRecoveryKey(
  storage: ProgramAuthoringStorage,
  idempotencyKey: string,
): void {
  storage.setItem(PROGRAM_AUTHORING_RECOVERY_KEY, idempotencyKey);
}

export function loadProgramAuthoringRecoveryKey(
  storage: ProgramAuthoringStorage,
): string | null {
  storage.removeItem(LEGACY_PROGRAM_AUTHORING_DRAFT_KEY);
  const idempotencyKey = storage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY);
  if (idempotencyKey === null || idempotencyKey.length > 0) {
    return idempotencyKey;
  }
  storage.removeItem(PROGRAM_AUTHORING_RECOVERY_KEY);
  return null;
}

export function clearProgramAuthoringRecoveryKey(
  storage: ProgramAuthoringStorage,
): void {
  storage.removeItem(PROGRAM_AUTHORING_RECOVERY_KEY);
  storage.removeItem(LEGACY_PROGRAM_AUTHORING_DRAFT_KEY);
}
