import { ProgramTrackType } from '@prisma/client';
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
    trackType: ProgramTrackType.CURRICULAR,
    applicationStartAt: '2026-08-01T09:00:00+09:00',
    applicationEndAt: '2026-08-10T09:00:00+09:00',
    endAt: '2026-09-01T09:00:00+09:00',
    description: ' Description ',
    milestones: [
      {
        name: ' First ',
        dueAt: '2026-08-20T09:00:00+09:00',
        documents: [
          {
            name: ' File ',
            required: true,
            templateUploadId: ' upload-1 ',
          },
          {
            name: ' Text ',
            required: false,
            templateUploadId: ' upload-2 ',
          },
        ],
      },
      {
        name: ' Second ',
        dueAt: '2026-08-25T09:00:00+09:00',
        documents: [
          {
            name: ' Summary ',
            required: true,
            templateUploadId: ' upload-3 ',
          },
        ],
      },
    ],
  };
}

describe('Program authoring canonical payload hash', () => {
  it('includes both external source and image in the idempotency payload', () => {
    const externalCover = {
      sourceUrl: 'https://sojoong.kr/notice/notice-board/?uid=123&mod=document',
      imageUrl: 'https://sojoong.kr/wp-content/uploads/synthetic.jpg',
    };
    const hash = (cover: typeof externalCover) =>
      hashProgramAuthoringPayload(
        buildProgramAuthoringPlan({ ...request(), externalCover: cover }),
      );
    expect(
      hash({
        ...externalCover,
        sourceUrl: externalCover.sourceUrl.replace('123', '124'),
      }),
    ).not.toBe(hash(externalCover));
    expect(
      hash({
        ...externalCover,
        imageUrl: externalCover.imageUrl.replace('synthetic', 'changed'),
      }),
    ).not.toBe(hash(externalCover));
    expect(
      hashProgramAuthoringPayload(
        buildProgramAuthoringPlan({ ...request(), externalCover: null }),
      ),
    ).toBe(hashProgramAuthoringPayload(buildProgramAuthoringPlan(request())));
  });
  it('preserves historical no-cover hashes and includes a selected cover token', () => {
    const original = buildProgramAuthoringPlan(request());
    const empty = buildProgramAuthoringPlan({
      ...request(),
      coverUploadId: null,
    });
    const covered = buildProgramAuthoringPlan({
      ...request(),
      coverUploadId: 'cover-upload',
    });
    expect(canonicalProgramAuthoringPayload(original)).not.toHaveProperty(
      'coverUploadId',
    );
    expect(hashProgramAuthoringPayload(empty)).toBe(
      hashProgramAuthoringPayload(original),
    );
    expect(hashProgramAuthoringPayload(covered)).not.toBe(
      hashProgramAuthoringPayload(original),
    );
    expect(covered.uploadTokenIds).toContain('cover-upload');
  });

  it('gives semantically equivalent normalized requests one schemaVersion 1 hash', () => {
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

      notifyOnDeadline: true,
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

    const implicitHash = hashProgramAuthoringPayload(implicit);
    const explicitHash = hashProgramAuthoringPayload(explicit);

    expect(canonicalProgramAuthoringPayload(implicit).schemaVersion).toBe(1);
    expect(implicitHash).toMatch(/^[0-9a-f]{64}$/);
    expect(explicitHash).toBe(implicitHash);
  });

  it('preserves milestone order, document order, and token identity in the hash', () => {
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
                  ? { ...document, templateUploadId: 'upload-4' }
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
