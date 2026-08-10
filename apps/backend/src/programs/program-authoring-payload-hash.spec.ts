import { MilestoneSubmissionType, ProgramCategory } from '@prisma/client';
import type { ProgramAuthoringRequest } from './program-authoring.types';
import { buildProgramAuthoringPlan } from './program-authoring-plan';
import {
  canonicalProgramAuthoringPayload,
  hashProgramAuthoringPayload,
} from './program-authoring-payload-hash';

function request(): ProgramAuthoringRequest {
  return {
    name: ' Program ',
    organizer: ' Organizer ',
    category: ProgramCategory.CAPSTONE,
    applicationStartAt: '2026-08-01T09:00:00+09:00',
    applicationEndAt: '2026-08-10T09:00:00+09:00',
    endAt: '2026-09-01T09:00:00+09:00',
    description: ' Description ',
    milestones: [
      {
        name: ' First ',
        dueAt: '2026-08-20T09:00:00+09:00',
        submissionType: MilestoneSubmissionType.FILE,
        documents: [
          {
            name: ' File ',
            required: true,
            submissionType: MilestoneSubmissionType.FILE,
            templateUploadId: ' upload-1 ',
          },
          {
            name: ' Text ',
            required: false,
            submissionType: MilestoneSubmissionType.TEXT,
          },
        ],
      },
      {
        name: ' Second ',
        dueAt: '2026-08-25T09:00:00+09:00',
        submissionType: MilestoneSubmissionType.TEXT,
        documents: [],
      },
    ],
  };
}

describe('Program authoring canonical payload hash', () => {
  it('gives semantically equivalent normalized requests one schemaVersion 1 hash', () => {
    // Given: equivalent requests use different whitespace, offsets, and default spelling.
    const implicit = buildProgramAuthoringPlan(request());
    const explicit = buildProgramAuthoringPlan({
      ...request(),
      name: 'Program',
      organizer: 'Organizer',
      description: 'Description',
      applicationStartAt: '2026-08-01T00:00:00.000Z',
      applicationEndAt: '2026-08-10T00:00:00.000Z',
      startAt: '2026-08-10T00:00:00.000Z',
      endAt: '2026-09-01T00:00:00.000Z',
      teamMinSize: 1,
      teamMaxSize: 1,
      repositoryProvisioningEnabled: false,
      notifyOnDeadline: false,
      milestones: request().milestones.map((milestone) => ({
        ...milestone,
        startAt: '2026-08-10T00:00:00.000Z',
        instructions: null,
        documents: milestone.documents.map((document) => ({
          ...document,
          name: document.name.trim(),
          templateUploadId: document.templateUploadId?.trim() ?? null,
        })),
      })),
    });

    // When: both plans are serialized and hashed.
    const implicitHash = hashProgramAuthoringPayload(implicit);
    const explicitHash = hashProgramAuthoringPayload(explicit);

    // Then: canonical payload version and digest are identical.
    expect(canonicalProgramAuthoringPayload(implicit).schemaVersion).toBe(1);
    expect(implicitHash).toMatch(/^[0-9a-f]{64}$/);
    expect(explicitHash).toBe(implicitHash);
  });

  it('preserves milestone order, document order, and token identity in the hash', () => {
    // Given: three payloads differ by exactly one ordered or identity-bearing value.
    const original = request();
    const reversedMilestones: ProgramAuthoringRequest = {
      ...original,
      milestones: [...original.milestones].reverse(),
    };
    const firstMilestone = original.milestones[0];
    const reversedDocuments: ProgramAuthoringRequest = {
      ...original,
      milestones: firstMilestone
        ? [
            {
              ...firstMilestone,
              documents: [...firstMilestone.documents].reverse(),
            },
            ...original.milestones.slice(1),
          ]
        : original.milestones,
    };
    const changedToken: ProgramAuthoringRequest = {
      ...original,
      milestones: firstMilestone
        ? [
            {
              ...firstMilestone,
              documents: firstMilestone.documents.map((document, index) =>
                index === 0
                  ? { ...document, templateUploadId: 'upload-2' }
                  : document,
              ),
            },
            ...original.milestones.slice(1),
          ]
        : original.milestones,
    };
    const originalHash = hashProgramAuthoringPayload(
      buildProgramAuthoringPlan(original),
    );

    // When / Then: each contract-bearing difference changes the digest.
    expect(
      hashProgramAuthoringPayload(
        buildProgramAuthoringPlan(reversedMilestones),
      ),
    ).not.toBe(originalHash);
    expect(
      hashProgramAuthoringPayload(buildProgramAuthoringPlan(reversedDocuments)),
    ).not.toBe(originalHash);
    expect(
      hashProgramAuthoringPayload(buildProgramAuthoringPlan(changedToken)),
    ).not.toBe(originalHash);
  });
});
