import { describe, expect, it } from 'vitest';
import {
  PROGRAM_AUTHORING_STEPS,
  buildProgramAuthoringManifest,
  createInitialProgramAuthoringState,
  createRequirementDraft,
  programAuthoringReducer,
  seoulDateTimeToIso,
  validateProgramAuthoringManifest,
  validateProgramAuthoringStep,
  validateTemplateFile,
} from './program-creation-flow';
import { completedAuthoringState } from './program-creation-test-fixtures';

describe('program authoring reducer', () => {
  it('defaults the team range to 1..1 and permits free step navigation', () => {
    // Given
    const initial = createInitialProgramAuthoringState({
      idempotencyKey: 'request-1',
      milestoneId: 'milestone-1',
    });

    // When
    const navigated = programAuthoringReducer(initial, {
      type: 'go_to_step',
      step: 'requirements',
    });

    // Then
    expect(navigated.teamMinSize).toBe('1');
    expect(navigated.teamMaxSize).toBe('1');
    expect(navigated.repositoryProvisioningEnabled).toBe(false);
    expect(navigated.notifyOnDeadline).toBe(false);
    expect(navigated.currentStep).toBe('requirements');
    expect(PROGRAM_AUTHORING_STEPS).toHaveLength(7);
  });

  it('stores the GitHub repository issuance choice in authoring state', () => {
    const initial = createInitialProgramAuthoringState({
      idempotencyKey: 'request-1',
      milestoneId: 'milestone-1',
    });

    const enabled = programAuthoringReducer(initial, {
      type: 'set_repository_provisioning_enabled',
      enabled: true,
    });

    expect(enabled.repositoryProvisioningEnabled).toBe(true);
  });

  it('stores the deadline notification choice independently from GitHub issuance', () => {
    const initial = createInitialProgramAuthoringState({
      idempotencyKey: 'request-1',
      milestoneId: 'milestone-1',
    });

    const enabled = programAuthoringReducer(initial, {
      type: 'set_notify_on_deadline',
      enabled: true,
    });

    expect(enabled.notifyOnDeadline).toBe(true);
    expect(enabled.repositoryProvisioningEnabled).toBe(false);
  });

  it('keeps requirement file metadata while marking the in-memory file selected', () => {
    // Given
    const initial = completedAuthoringState();
    const requirement = createRequirementDraft('requirement-file');
    const withRequirement = {
      ...initial,
      milestones: [
        {
          ...initial.milestones[0],
          requirements: [requirement],
        },
      ],
    };

    // When
    const next = programAuthoringReducer(withRequirement, {
      type: 'set_requirement_file',
      milestoneId: 'milestone-1',
      requirementId: requirement.id,
      file: {
        name: 'plan.pdf',
        size: 1024,
        type: 'application/pdf',
      },
    });

    // Then
    expect(next.milestones[0]?.requirements[0]?.templateFile).toEqual({
      name: 'plan.pdf',
      size: 1024,
      type: 'application/pdf',
      requiresReselection: false,
    });
  });
});

describe('program authoring validation', () => {
  it('validates only the current step when Next is used', () => {
    // Given
    const incomplete = createInitialProgramAuthoringState({
      idempotencyKey: 'request-1',
      milestoneId: 'milestone-1',
    });

    // When
    const typeIssues = validateProgramAuthoringStep(incomplete, 'type');
    const basicIssues = validateProgramAuthoringStep(incomplete, 'basic');

    // Then
    expect(typeIssues).toEqual([]);
    expect(basicIssues.map((issue) => issue.path)).toEqual([
      'name',
      'organizer',
      'description',
    ]);
  });

  it('requires one milestone but accepts an informational milestone with no requirements', () => {
    // Given
    const completed = completedAuthoringState();

    // When
    const noMilestoneIssues = validateProgramAuthoringManifest({
      ...completed,
      milestones: [],
    });
    const informationalIssues = validateProgramAuthoringManifest(completed);

    // Then
    expect(noMilestoneIssues).toContainEqual(
      expect.objectContaining({ path: 'milestones', step: 'milestones' }),
    );
    expect(informationalIssues).toEqual([]);
  });

  it('matches the server schedule and team range rules', () => {
    // Given
    const completed = completedAuthoringState();

    // When
    const issues = validateProgramAuthoringManifest({
      ...completed,
      applicationEndAt: '2026-09-02T09:01',
      operationStartAt: '2026-09-02T09:00',
      teamMinSize: '0',
      teamMaxSize: '101',
      milestones: [
        {
          ...completed.milestones[0],
          startAt: '2026-08-31T09:00',
          dueAt: '2026-10-01T18:00',
        },
      ],
    });

    // Then
    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'operationStartAt',
        'teamMinSize',
        'teamMaxSize',
        'milestones.milestone-1.startAt',
        'milestones.milestone-1.dueAt',
      ]),
    );
  });

  it('requires a refreshed template file to be reselected', () => {
    // Given
    const completed = completedAuthoringState();
    const requirement = {
      ...createRequirementDraft('requirement-file'),
      name: '계획서',
      submissionType: 'FILE' as const,
      templateFile: {
        name: 'plan.pdf',
        size: 1024,
        type: 'application/pdf',
        requiresReselection: true,
      },
    };

    // When
    const issues = validateProgramAuthoringManifest({
      ...completed,
      milestones: [{ ...completed.milestones[0], requirements: [requirement] }],
    });

    // Then
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: 'requirements.requirement-file.templateFile',
        step: 'requirements',
      }),
    );
  });

  it('rejects oversized and unsupported template files before upload', () => {
    expect(
      validateTemplateFile(
        new File(['content'], 'plan.txt', { type: 'text/plain' }),
      ),
    ).toBe('PDF, HWP, JPG, PNG, ZIP 파일만 선택할 수 있습니다.');
    expect(
      validateTemplateFile(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'plan.pdf', {
          type: 'application/pdf',
        }),
      ),
    ).toBe('파일은 5MiB 이하여야 합니다.');
  });
});

describe('program authoring manifest', () => {
  it('converts Seoul wall-clock values to stable ISO instants and attaches upload tokens', () => {
    // Given
    const completed = completedAuthoringState();
    const requirement = {
      ...createRequirementDraft('requirement-file'),
      name: '계획서',
      submissionType: 'FILE' as const,
      templateFile: {
        name: 'plan.pdf',
        size: 1024,
        type: 'application/pdf',
        requiresReselection: false,
      },
    };
    const state = {
      ...completed,
      repositoryProvisioningEnabled: true,
      notifyOnDeadline: true,
      milestones: [{ ...completed.milestones[0], requirements: [requirement] }],
    };

    // When
    const manifest = buildProgramAuthoringManifest(
      state,
      new Map([['requirement-file', 'upload-token']]),
    );

    // Then
    expect(seoulDateTimeToIso('2026-09-01T09:00')).toBe(
      '2026-09-01T00:00:00.000Z',
    );
    expect(manifest.startAt).toBe('2026-09-02T00:00:00.000Z');
    expect(manifest.milestones[0]?.documents[0]?.templateUploadId).toBe(
      'upload-token',
    );
    expect(manifest.repositoryProvisioningEnabled).toBe(true);
    expect(manifest.notifyOnDeadline).toBe(true);
  });
});
