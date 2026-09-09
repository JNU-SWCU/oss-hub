import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../../milestone-documents/milestone-documents-error-code.enum';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';
import {
  createProgramEditorServiceHarness,
  editableProgram,
} from '../../../test/program-editor-service-fixtures';
import { fingerprintProgramMilestoneEdit } from '../program-milestone-edit';
import { ProgramAuthoringUploadTokenError } from '../program-authoring.types';

describe('ProgramEditorService authority', () => {
  it('loads edit data by canonical program id inside one repository transaction', async () => {
    const { service, store, withTransaction } =
      createProgramEditorServiceHarness();
    store.findEditableProgramById.mockResolvedValue(editableProgram);

    await expect(service.getProgram(101n, 'program-1')).resolves.toBe(
      editableProgram,
    );

    expect(withTransaction.mock.calls).toHaveLength(1);
    expect(store.findEditableProgramById.mock.calls[0]).toEqual(['program-1']);
  });

  it('rejects inactive staff before edit data is exposed', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findUserAuthorityByGithubId.mockResolvedValue({
      id: 'staff-1',
      hasAdminAccess: false,
      hasStaffAccess: true,
      accountStatus: AccountStatus.DEACTIVATED,
      staffAccessRequests: [],
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
      id: 'staff-1',
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
      staffAccessRequests: [{ status: StaffAccessRequestStatus.PENDING }],
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
      id: 'staff-1',
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.DEACTIVATED,
      staffAccessRequests: [{ status: StaffAccessRequestStatus.PENDING }],
    });

    await expect(service.getProgram(101n, 'program-1')).rejects.toMatchObject<
      Partial<DomainException>
    >({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN],
    });
    expect(store.findEditableProgramById.mock.calls).toHaveLength(0);
  });

  it('allows an existing zero-document milestone to remain empty', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    const locked = lockedMilestoneEdit([]);
    store.lockMilestoneEdit.mockResolvedValue(locked);
    store.countSubmissionHistoriesForDocuments.mockResolvedValue(0);
    store.lockAttachableUploads.mockResolvedValue([]);

    await expect(
      service.updateMilestoneEdit(101n, 'milestone-1', requestFor(locked)),
    ).resolves.toMatchObject({ documents: [] });
    expect(store.lockAttachableUploads.mock.calls).toEqual([['staff-1', []]]);
    expect(store.applyMilestoneEdit.mock.calls).toHaveLength(1);
  });

  it('rejects removing the last existing document before token locking or writes', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    const locked = lockedMilestoneEdit([
      {
        id: 'document-1',
        name: 'Report',
        required: true,
        sortOrder: 1,
        templateFileName: null,
      },
    ]);
    store.lockMilestoneEdit.mockResolvedValue(locked);

    await expect(
      service.updateMilestoneEdit(101n, 'milestone-1', requestFor(locked)),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.LAST_DOCUMENT_REQUIRED
        ],
    });
    expect(store.lockAttachableUploads.mock.calls).toHaveLength(0);
    expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
  });

  it('maps an expired locked upload to its document field without writing', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    const locked = lockedMilestoneEdit([
      {
        id: 'document-1',
        name: 'Report',
        required: true,
        sortOrder: 1,
        templateFileName: null,
      },
    ]);
    store.lockMilestoneEdit.mockResolvedValue(locked);
    store.countSubmissionHistoriesForDocuments.mockResolvedValue(0);
    store.lockAttachableUploads.mockRejectedValue(
      new ProgramAuthoringUploadTokenError('EXPIRED', ['upload-expired']),
    );
    const input = {
      ...requestFor(locked),
      documents: [
        {
          id: 'document-1',
          name: 'Report',
          required: true,
          templateUploadId: 'upload-expired',
        },
      ],
    };

    await expect(
      service.updateMilestoneEdit(101n, 'milestone-1', input),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
      extensions: {
        fieldErrors: [
          {
            field: 'documents[0].templateUploadId',
            code: 'INVALID_UPLOAD_TOKEN',
            message: '업로드 파일을 다시 준비한 뒤 저장해 주세요.',
          },
        ],
      },
    });
    expect(store.lockAttachableUploads.mock.calls).toEqual([
      ['staff-1', ['upload-expired']],
    ]);
    expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
  });
});

function lockedMilestoneEdit(
  documents: readonly {
    readonly id: string;
    readonly name: string;
    readonly required: boolean;
    readonly sortOrder: number;
    readonly templateFileName: string | null;
  }[],
) {
  const milestone = editableProgram.milestones[0];
  if (milestone === undefined) {
    throw new Error('Expected editable program milestone fixture.');
  }
  return {
    programId: 'program-1',
    milestoneUpdatedAt: new Date('2026-08-16T00:00:00.000Z'),
    view: {
      milestone,
      operation: {
        startAt: editableProgram.startAt,
        endAt: new Date(editableProgram.endAt),
      },
      documents,
    },
    fingerprintDocuments: documents.map((document) => ({
      ...document,
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
      storageKey: null,
    })),
  };
}

function requestFor(locked: ReturnType<typeof lockedMilestoneEdit>) {
  return {
    expectedFingerprint: fingerprintProgramMilestoneEdit({
      operation: locked.view.operation,
      milestone: {
        ...locked.view.milestone,
        updatedAt: locked.milestoneUpdatedAt,
      },
      documents: locked.fingerprintDocuments,
    }),
    name: locked.view.milestone.name,
    startAt: locked.view.milestone.startAt.toISOString(),
    dueAt: locked.view.milestone.dueAt.toISOString(),
    instructions: locked.view.milestone.instructions,
    documents: [],
  };
}
