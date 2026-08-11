import 'reflect-metadata';
import { MilestoneSubmissionType, ProgramCategory } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProgramAuthoringRequestDto } from './program-authoring-request.dto';

function request() {
  return {
    name: 'Synthetic Program',
    organizer: 'Synthetic Organizer',
    category: ProgramCategory.CAPSTONE,
    applicationStartAt: '2026-08-01T00:00:00.000Z',
    applicationEndAt: '2026-08-10T00:00:00.000Z',
    startAt: '2026-08-10T00:00:00.000Z',
    endAt: '2026-09-01T00:00:00.000Z',
    teamMinSize: 1,
    teamMaxSize: 4,
    repositoryProvisioningEnabled: true,
    notifyOnDeadline: true,
    description: 'Synthetic description',
    milestones: [
      {
        name: 'Planning',
        startAt: '2026-08-11T00:00:00.000Z',
        dueAt: '2026-08-20T00:00:00.000Z',
        submissionType: MilestoneSubmissionType.FILE,
        instructions: 'Submit the plan',
        documents: [
          {
            name: 'Plan',
            required: true,
            submissionType: MilestoneSubmissionType.FILE,
            templateUploadId: 'upload-plan',
          },
        ],
      },
    ],
  };
}

function milestone() {
  const value = request().milestones[0];
  if (value === undefined) throw new Error('Missing milestone fixture');
  return value;
}

function document() {
  const value = milestone().documents[0];
  if (value === undefined) throw new Error('Missing document fixture');
  return value;
}

async function errors(input: object) {
  return validate(plainToInstance(ProgramAuthoringRequestDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('ProgramAuthoringRequestDto', () => {
  it('accepts the complete nested aggregate request', async () => {
    await expect(errors(request())).resolves.toEqual([]);
  });

  it('rejects unknown nested fields', async () => {
    const input = request();
    const milestoneFixture = milestone();

    await expect(
      errors({
        ...input,
        milestones: [
          {
            ...milestoneFixture,
            documents: [{ ...document(), storageKey: 'hidden' }],
          },
        ],
      }),
    ).resolves.not.toEqual([]);
  });

  it.each([
    ['0 milestones', { milestones: [] }],
    [
      '51 milestones',
      { milestones: Array.from({ length: 51 }, () => milestone()) },
    ],
    [
      '21 documents in one milestone',
      {
        milestones: [
          {
            ...milestone(),
            documents: Array.from({ length: 21 }, () => document()),
          },
        ],
      },
    ],
    [
      '101 total documents',
      {
        milestones: [
          ...Array.from({ length: 5 }, () => ({
            ...milestone(),
            documents: Array.from({ length: 20 }, () => document()),
          })),
          {
            ...milestone(),
            documents: [document()],
          },
        ],
      },
    ],
  ])('rejects %s', async (_caseName, override) => {
    await expect(errors({ ...request(), ...override })).resolves.not.toEqual(
      [],
    );
  });

  it('rejects submission types outside FILE and TEXT at every nested level', async () => {
    const input = request();
    const milestoneFixture = milestone();

    await expect(
      errors({
        ...input,
        milestones: [
          {
            ...milestoneFixture,
            submissionType: 'REPOSITORY_RELEASE',
            documents: [
              {
                ...document(),
                submissionType: 'REPOSITORY_RELEASE',
              },
            ],
          },
        ],
      }),
    ).resolves.not.toEqual([]);
  });
});
