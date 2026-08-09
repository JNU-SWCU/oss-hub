import { ProgramCategory } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';
import {
  createProgramEditorServiceHarness,
  editableProgram,
  teamInputFor,
  updateInput,
} from '../../../test/program-editor-service-fixtures';

describe('ProgramEditorService update validation', () => {
  it('rejects changing to a team template without a complete team range', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    const exception = await expectDomainException(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        teamMinSize: null,
        teamMaxSize: null,
      }),
    );

    expect(exception.errorCode).toBe(
      PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    );
    expect(exception.extensions.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'teamMinSize' }),
        expect.objectContaining({ field: 'teamMaxSize' }),
      ]),
    );
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('rejects a reversed application period with the exact editor period contract', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    const exception = await expectDomainException(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        applicationEndAt: '2026-07-31T00:00:00.000Z',
      }),
    );

    expect(exception.errorCode).toBe(
      PROGRAM_ERROR_CODES[ProgramErrorCode.INVALID_APPLICATION_PERIOD],
    );
    expect(exception.extensions.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'applicationStartAt' }),
        expect.objectContaining({ field: 'applicationEndAt' }),
      ]),
    );
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });
  it('rejects an end date before the application end date', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    const exception = await expectDomainException(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        endAt: '2026-08-14T00:00:00.000Z',
      }),
    );

    expect(exception.errorCode).toBe(
      PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    );
    expect(exception.extensions.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'endAt',
          code: 'INVALID_PROGRAM_END',
        }),
      ]),
    );
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('rejects moving application end past an existing end date', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue({
      ...editableProgram,
      endAt: '2026-08-16T00:00:00.000Z',
    });

    await expect(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        applicationEndAt: '2026-08-17T00:00:00.000Z',
        endAt: undefined,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    });
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('rejects an equal application period with the exact editor period contract', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    await expect(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        applicationStartAt: '2026-08-01T00:00:00.000Z',
        applicationEndAt: '2026-08-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.INVALID_APPLICATION_PERIOD],
    });
    expect(
      PROGRAM_ERROR_CODES[ProgramErrorCode.INVALID_APPLICATION_PERIOD].status,
    ).toBe(422);
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('rejects category changes after applications exist before writing updates', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue({
      ...editableProgram,
      applicationCount: 1,
      category: ProgramCategory.BASIC,
    });

    await expect(
      service.updateProgram(101n, 'program-1', updateInput),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS],
    });
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('rejects category changes after teams exist even without applications before writing updates', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue({
      ...editableProgram,
      applicationCount: 0,
      teamCount: 1,
      category: ProgramCategory.BASIC,
    });

    await expect(
      service.updateProgram(101n, 'program-1', updateInput),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS],
    });
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it.each(Object.values(ProgramCategory))(
    'allows %s intake-only template mode without milestones',
    async (category) => {
      const { service, store } = createProgramEditorServiceHarness();
      store.findEditableProgramForUpdate.mockResolvedValue({
        ...editableProgram,
        category,
        milestones: [],
      });
      const teamInput = teamInputFor(category);
      store.updateProgram.mockResolvedValue({
        ...editableProgram,
        ...teamInput,
        category,
        repositoryProvisioningEnabled: false,
        milestones: [],
      });

      await expect(
        service.updateProgram(101n, 'program-1', {
          ...updateInput,
          category,
          repositoryProvisioningEnabled: false,
          ...teamInput,
        }),
      ).resolves.toMatchObject({ category });
    },
  );

  it.each(Object.values(ProgramCategory))(
    'requires at least one milestone for %s when repository automation is enabled',
    async (category) => {
      const { service, store } = createProgramEditorServiceHarness();
      store.findEditableProgramForUpdate.mockResolvedValue({
        ...editableProgram,
        category,
        milestones: [],
      });
      const teamInput = teamInputFor(category);

      await expect(
        service.updateProgram(101n, 'program-1', {
          ...updateInput,
          category,
          repositoryProvisioningEnabled: true,
          ...teamInput,
        }),
      ).rejects.toMatchObject<Partial<DomainException>>({
        errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_REQUIRED],
      });
      expect(store.updateProgram.mock.calls).toHaveLength(0);
    },
  );

  it('rejects an application end date that reaches an existing milestone', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    await expect(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        applicationEndAt: '2026-08-20T00:00:00.000Z',
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_BEFORE_APPLICATION_END],
    });
  });
  it('allows a legacy program without an end date to set one', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);
    store.updateProgram.mockResolvedValue({
      ...editableProgram,
      endAt: '2026-09-01T00:00:00.000Z',
    });

    await service.updateProgram(101n, 'program-1', {
      ...updateInput,
      endAt: '2026-09-01T00:00:00.000Z',
    });

    expect(store.updateProgram.mock.calls).toContainEqual([
      expect.objectContaining({
        endAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ]);
  });

  it('forbids clearing a non-null program end date', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue({
      ...editableProgram,
      endAt: '2026-09-01T00:00:00.000Z',
    });

    const exception = await expectDomainException(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        endAt: null,
      }),
    );

    expect(exception.extensions.fieldErrors).toEqual([
      expect.objectContaining({ field: 'endAt' }),
    ]);
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('rejects a non-finite or application-boundary program end date', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    for (const endAt of ['not-a-date', updateInput.applicationEndAt] as const) {
      const exception = await expectDomainException(
        service.updateProgram(101n, 'program-1', {
          ...updateInput,
          endAt,
        }),
      );
      expect(exception.extensions.fieldErrors).toEqual([
        expect.objectContaining({ field: 'endAt' }),
      ]);
    }
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('rejects a program end date at an existing milestone boundary', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    const exception = await expectDomainException(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        endAt: editableProgram.milestones[0].dueAt.toISOString(),
      }),
    );

    expect(exception.extensions.fieldErrors).toEqual([
      expect.objectContaining({ field: 'endAt' }),
    ]);
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('allows moving a set program end later while preserving other update data', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue({
      ...editableProgram,
      endAt: '2026-09-01T00:00:00.000Z',
    });
    store.updateProgram.mockResolvedValue({
      ...editableProgram,
      endAt: '2026-10-01T00:00:00.000Z',
    });

    await service.updateProgram(101n, 'program-1', {
      ...updateInput,
      endAt: '2026-10-01T00:00:00.000Z',
    });

    expect(store.updateProgram.mock.calls).toContainEqual([
      expect.objectContaining({
        name: 'Updated OSS',
        endAt: new Date('2026-10-01T00:00:00.000Z'),
        liveFileExpiresAt: new Date('2027-10-01T00:00:00.000Z'),
      }),
    ]);
  });

  it('moves live file expiry earlier with an earlier valid program end', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue({
      ...editableProgram,
      endAt: '2026-10-01T00:00:00.000Z',
    });
    store.updateProgram.mockResolvedValue({
      ...editableProgram,
      endAt: '2026-09-01T00:00:00.000Z',
    });

    await service.updateProgram(101n, 'program-1', {
      ...updateInput,
      endAt: '2026-09-01T00:00:00.000Z',
    });

    expect(store.updateProgram.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        liveFileExpiresAt: new Date('2027-09-01T00:00:00.000Z'),
      }),
    );
  });

  it('does not rewrite live file expiry when the program end is unchanged', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue({
      ...editableProgram,
      endAt: '2026-09-01T00:00:00.000Z',
    });
    store.updateProgram.mockResolvedValue({
      ...editableProgram,
      endAt: '2026-09-01T00:00:00.000Z',
    });

    await service.updateProgram(101n, 'program-1', {
      ...updateInput,
      endAt: '2026-09-01T00:00:00.000Z',
    });

    expect(store.updateProgram.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ liveFileExpiresAt: null }),
    );
  });
});

async function expectDomainException(
  promise: Promise<unknown>,
): Promise<DomainException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainException) return error;
    throw error;
  }
  throw new Error('Expected DomainException.');
}
