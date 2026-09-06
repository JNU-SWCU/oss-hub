import {
  fingerprintProgramMilestoneEdit,
  preflightProgramMilestoneEditDocuments,
  ProgramMilestoneEditValidationError,
} from './program-milestone-edit';

const operation = {
  startAt: new Date('2026-08-16T00:00:00.000Z'),
  endAt: new Date('2026-08-31T00:00:00.000Z'),
};

function fingerprint(storageKey: string | null): string {
  return fingerprintProgramMilestoneEdit({
    operation,
    milestone: {
      id: 'milestone-1',
      name: 'Final report',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: null,
      instructions: null,
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
    },
    documents: [
      {
        id: 'document-1',
        name: 'Report',
        required: true,
        sortOrder: 1,
        updatedAt: new Date('2026-08-16T00:00:00.000Z'),
        storageKey,
      },
    ],
  });
}

describe('fingerprintProgramMilestoneEdit', () => {
  it('uses a lowercase SHA-256 hash and changes when only the template storage key changes', () => {
    const original = fingerprint('templates/original');
    const replacement = fingerprint('templates/replacement');

    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(replacement).not.toBe(original);
  });

  it('distinguishes the JSON null template sentinel from a template storage key', () => {
    expect(fingerprint(null)).not.toBe(fingerprint('templates/original'));
  });
});

describe('preflightProgramMilestoneEditDocuments', () => {
  it('accepts 20 distinct documents and tokens', () => {
    expect(() =>
      preflightProgramMilestoneEditDocuments(
        Array.from({ length: 20 }, (_, index) => ({
          id: `document-${index}`,
          templateUploadId: `upload-${index}`,
        })),
      ),
    ).not.toThrow();
  });

  it.each([
    [
      'duplicate existing document IDs',
      [{ id: 'document-1' }, { id: 'document-1' }],
      'documents[1].id',
    ],
    [
      'duplicate upload tokens',
      [
        { id: null, templateUploadId: 'upload-1' },
        { id: null, templateUploadId: 'upload-1' },
      ],
      'documents[1].templateUploadId',
    ],
  ])('reports the indexed field for %s', (_caseName, documents, field) => {
    try {
      preflightProgramMilestoneEditDocuments(documents);
      throw new Error('Expected duplicate document preflight error.');
    } catch (error) {
      expect(error).toBeInstanceOf(ProgramMilestoneEditValidationError);
      if (!(error instanceof ProgramMilestoneEditValidationError)) throw error;
      expect(error.field).toBe(field);
      expect(error.code).toBe(
        field === 'documents[1].id'
          ? 'DUPLICATE_DOCUMENT_ID'
          : 'DUPLICATE_UPLOAD_TOKEN',
      );
    }
  });

  it('rejects 21 documents', () => {
    expect(() =>
      preflightProgramMilestoneEditDocuments(
        Array.from({ length: 21 }, () => ({ id: null })),
      ),
    ).toThrow(ProgramMilestoneEditValidationError);
  });
});
