import { AccountStatus, RoleRequestStatus, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.enum';
import {
  createProgramEditorServiceHarness,
  editableProgram,
} from '../../test/program-editor-service-fixtures';

describe('ProgramEditorService authority', () => {
  it('loads edit data by canonical program id inside one repository transaction', async () => {
    const { service, store, withTransaction } =
      createProgramEditorServiceHarness();
    store.findEditableProgramById.mockResolvedValue(editableProgram);

    await expect(service.getProgram(101n, 'program-1')).resolves.toBe(
      editableProgram,
    );

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(store.findEditableProgramById.mock.calls[0]).toEqual(['program-1']);
  });

  it('rejects inactive staff before edit data is exposed', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findUserAuthorityByGithubId.mockResolvedValue({
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
      roleRequests: [],
    });

    await expect(service.getProgram(101n, 'program-1')).rejects.toMatchObject<
      Partial<DomainException>
    >({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN],
    });
    expect(store.findEditableProgramById.mock.calls).toHaveLength(0);
  });

  it('rejects pending staff approval with the dedicated editor error before data is exposed', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findUserAuthorityByGithubId.mockResolvedValue({
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      roleRequests: [{ status: RoleRequestStatus.PENDING }],
    });

    await expect(service.getProgram(101n, 'program-1')).rejects.toMatchObject<
      Partial<DomainException>
    >({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.STAFF_APPROVAL_REQUIRED],
    });
    expect(store.findEditableProgramById.mock.calls).toHaveLength(0);
  });

  it('keeps inactive pending staff approval on the common forbidden path', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findUserAuthorityByGithubId.mockResolvedValue({
      role: null,
      accountStatus: AccountStatus.DEACTIVATED,
      roleRequests: [{ status: RoleRequestStatus.PENDING }],
    });

    await expect(service.getProgram(101n, 'program-1')).rejects.toMatchObject<
      Partial<DomainException>
    >({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN],
    });
    expect(store.findEditableProgramById.mock.calls).toHaveLength(0);
  });
});
