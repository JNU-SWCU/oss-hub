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
  /**
   * 이 자리에는 원래 "생략하면 템플릿 기본값 1..1 로 되돌린다"는 반대 계약이 있었다.
   * 그 계약이 #936 을 만들었다 — 개인형 유형 프로그램은 수정 화면이 팀 인원 칸을
   * 렌더하지 않아 값을 실을 수 없었고, 교직원이 설명만 고쳐 저장해도 정원 3..5 가
   * 1..1 로 깎여 아무도 팀에 합류할 수 없게 됐다. 생략은 변경 없음이다.
   */
  it('요청이 팀 인원을 생략하면 지금 저장된 값을 그대로 둔다', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    const stored = { ...editableProgram, teamMinSize: 3, teamMaxSize: 5 };
    store.findEditableProgramForUpdate.mockResolvedValue(stored);
    store.updateProgram.mockResolvedValue(stored);

    await service.updateProgram(101n, 'program-1', {
      ...updateInput,
      teamMinSize: null,
      teamMaxSize: null,
    });

    expect(store.updateProgram.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ teamMinSize: 3, teamMaxSize: 5 }),
    );
  });

  it('한쪽만 생략해도 생략한 쪽만 저장된 값을 유지한다', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    const stored = { ...editableProgram, teamMinSize: 3, teamMaxSize: 5 };
    store.findEditableProgramForUpdate.mockResolvedValue(stored);
    store.updateProgram.mockResolvedValue(stored);

    await service.updateProgram(101n, 'program-1', {
      ...updateInput,
      teamMinSize: null,
      teamMaxSize: 10,
    });

    expect(store.updateProgram.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ teamMinSize: 3, teamMaxSize: 10 }),
    );
  });

  it('명시한 팀 인원은 저장된 값을 대체한다', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    const stored = { ...editableProgram, teamMinSize: 3, teamMaxSize: 5 };
    store.findEditableProgramForUpdate.mockResolvedValue(stored);
    store.updateProgram.mockResolvedValue(stored);

    await service.updateProgram(101n, 'program-1', {
      ...updateInput,
      teamMinSize: 1,
      teamMaxSize: 10,
    });

    expect(store.updateProgram.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ teamMinSize: 1, teamMaxSize: 10 }),
    );
  });

  it('정수가 아닌 팀 인원은 저장하지 않고 거부한다', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    const exception = await expectDomainException(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        teamMaxSize: 2.5,
      }),
    );

    expect(exception.errorCode).toBe(
      PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
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

  it('allows an equal application boundary before the operating period', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);
    store.updateProgram.mockResolvedValue(editableProgram);

    await expect(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        applicationStartAt: '2026-08-01T00:00:00.000Z',
        applicationEndAt: '2026-08-01T00:00:00.000Z',
      }),
    ).resolves.toBeDefined();
    expect(store.updateProgram.mock.calls).toHaveLength(1);
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
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
      extensions: {
        fieldErrors: [expect.objectContaining({ field: 'startAt' })],
      },
    });
  });
  it('기존 종료일이 있는 프로그램의 종료일 변경을 허용한다', async () => {
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

  it('rejects moving program start after an existing milestone start on startAt', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findEditableProgramForUpdate.mockResolvedValue({
      ...editableProgram,
      applicationStartAt: new Date('2026-04-13T03:40:00.000Z'),
      applicationEndAt: new Date('2026-08-01T03:40:00.000Z'),
      startAt: new Date('2026-08-18T03:41:00.000Z'),
      endAt: '2026-08-30T03:41:00.000Z',
      milestones: [
        {
          id: 'milestone-1',
          name: '계획서',
          startAt: new Date('2026-08-18T03:41:00.000Z'),
          dueAt: new Date('2026-08-29T03:41:00.000Z'),
          submissionType: editableProgram.milestones[0].submissionType,
          instructions: null,
        },
        {
          id: 'milestone-2',
          name: '결과보고서',
          startAt: new Date('2026-08-18T03:42:00.000Z'),
          dueAt: new Date('2026-08-29T03:42:00.000Z'),
          submissionType: editableProgram.milestones[0].submissionType,
          instructions: null,
        },
      ],
    });

    const exception = await expectDomainException(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        applicationStartAt: '2026-04-13T03:40:00.000Z',
        applicationEndAt: '2026-08-24T03:40:00.000Z',
        startAt: '2026-08-24T03:41:00.000Z',
        endAt: '2026-08-30T03:41:00.000Z',
      }),
    );

    expect(exception.errorCode).toBe(
      PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    );
    expect(exception.extensions.fieldErrors).toEqual([
      expect.objectContaining({
        field: 'startAt',
        code: 'INVALID_PROGRAM_START',
      }),
    ]);
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
