import { describe, expect, it, vi } from 'vitest';
import { completedAuthoringState } from './program-creation-test-fixtures';
import {
  PROGRAM_AUTHORING_STORAGE_KEY,
  PROGRAM_AUTHORING_STORAGE_VERSION,
  clearProgramAuthoringState,
  loadProgramAuthoringState,
  persistProgramAuthoringState,
  serializeProgramAuthoringState,
} from './program-authoring-storage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

describe('program authoring storage recovery', () => {
  it('round-trips versioned non-file state and requires file reselection after refresh', () => {
    // Given
    const completed = completedAuthoringState();
    const withFile = {
      ...completed,
      repositoryProvisioningEnabled: true,
      notifyOnDeadline: true,
      milestones: [
        {
          ...completed.milestones[0],
          requirements: [
            {
              id: 'requirement-file',
              name: '계획서',
              required: true,
              submissionType: 'FILE' as const,
              templateFile: {
                name: 'plan.pdf',
                size: 1024,
                type: 'application/pdf',
                requiresReselection: false,
              },
            },
          ],
        },
      ],
    };
    const storage = memoryStorage();

    // When
    persistProgramAuthoringState(storage, withFile);
    const restored = loadProgramAuthoringState(storage);

    // Then
    expect(restored?.idempotencyKey).toBe('request-1');
    expect(restored?.repositoryProvisioningEnabled).toBe(true);
    expect(restored?.notifyOnDeadline).toBe(true);
    expect(
      restored?.milestones[0]?.requirements[0]?.templateFile
        ?.requiresReselection,
    ).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      PROGRAM_AUTHORING_STORAGE_KEY,
      expect.stringContaining(`"version":${PROGRAM_AUTHORING_STORAGE_VERSION}`),
    );
  });

  it('discards stale and malformed storage versions', () => {
    const storage = memoryStorage();
    storage.setItem(
      PROGRAM_AUTHORING_STORAGE_KEY,
      JSON.stringify({
        version: PROGRAM_AUTHORING_STORAGE_VERSION + 1,
        state: completedAuthoringState(),
      }),
    );
    expect(loadProgramAuthoringState(storage)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(
      PROGRAM_AUTHORING_STORAGE_KEY,
    );

    storage.setItem(PROGRAM_AUTHORING_STORAGE_KEY, '{malformed');
    expect(loadProgramAuthoringState(storage)).toBeNull();
  });

  it('clears persisted state on confirmed discard or success', () => {
    const storage = memoryStorage();
    persistProgramAuthoringState(storage, completedAuthoringState());

    clearProgramAuthoringState(storage);

    expect(storage.removeItem).toHaveBeenCalledWith(
      PROGRAM_AUTHORING_STORAGE_KEY,
    );
  });

  it('falls back a stale requirements step to milestones instead of discarding the whole state', () => {
    // Given
    const storage = memoryStorage();
    const legacy = {
      ...completedAuthoringState(),
      currentStep: 'requirements',
    };
    storage.setItem(
      PROGRAM_AUTHORING_STORAGE_KEY,
      JSON.stringify({
        version: PROGRAM_AUTHORING_STORAGE_VERSION,
        state: legacy,
      }),
    );

    // When
    const restored = loadProgramAuthoringState(storage);

    // Then
    expect(restored?.currentStep).toBe('milestones');
    expect(restored?.name).toBe(legacy.name);
  });

  it('serializes state without a File object', () => {
    const serialized = serializeProgramAuthoringState(
      completedAuthoringState(),
    );

    expect(serialized).not.toContain('[object File]');
    expect(serialized).toContain('"idempotencyKey":"request-1"');
  });
});
