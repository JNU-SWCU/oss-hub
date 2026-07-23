import { ProgramCategory } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.enum';
import {
  createProgramEditorServiceHarness,
  editableProgram,
  teamInputFor,
  updateInput,
} from '../../test/program-editor-service-fixtures';

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
