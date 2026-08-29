import { describe, expect, it, vi } from 'vitest';
import {
  PROGRAM_AUTHORING_RECOVERY_KEY,
  clearProgramAuthoringRecoveryKey,
  loadProgramAuthoringRecoveryKey,
  persistProgramAuthoringRecoveryKey,
} from './program-authoring-storage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

describe('program authoring conflict recovery storage', () => {
  it('persists and reloads only the opaque idempotency key', () => {
    const storage = memoryStorage();

    persistProgramAuthoringRecoveryKey(storage, 'request-recovery-2');

    expect(loadProgramAuthoringRecoveryKey(storage)).toBe('request-recovery-2');
    expect(storage.setItem).toHaveBeenCalledWith(
      PROGRAM_AUTHORING_RECOVERY_KEY,
      'request-recovery-2',
    );
    expect(storage.setItem.mock.calls[0]?.[1]).not.toContain('milestones');
  });

  it('removes an empty recovery key instead of reusing it', () => {
    const storage = memoryStorage();
    storage.setItem(PROGRAM_AUTHORING_RECOVERY_KEY, '');

    expect(loadProgramAuthoringRecoveryKey(storage)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(
      PROGRAM_AUTHORING_RECOVERY_KEY,
    );
  });

  it('clears the recovery key after successful creation', () => {
    const storage = memoryStorage();
    persistProgramAuthoringRecoveryKey(storage, 'request-recovery-2');

    clearProgramAuthoringRecoveryKey(storage);

    expect(storage.removeItem).toHaveBeenCalledWith(
      PROGRAM_AUTHORING_RECOVERY_KEY,
    );
  });
});
