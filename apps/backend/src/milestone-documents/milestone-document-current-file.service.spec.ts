import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import type { SubmissionFileStoragePort } from '../submissions/submission-file-storage.port';
import type {
  CurrentMilestoneDocumentFile,
  MilestoneDocumentCurrentFileReader,
} from './milestone-document-current-file.repository';
import { MilestoneDocumentCurrentFileService } from './milestone-document-current-file.service';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';

const CURRENT_FILE: CurrentMilestoneDocumentFile = {
  storageKey: 'objects/current',
  originalFileName: 'current.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 13,
};

function buildStorage(
  get: (objectKey: string) => Promise<Readable> = () =>
    Promise.resolve(Readable.from(Buffer.from('current-bytes'))),
): SubmissionFileStoragePort {
  return {
    put: jest.fn(),
    get,
    delete: jest.fn(),
  };
}

function buildReader(
  file: CurrentMilestoneDocumentFile | null,
): MilestoneDocumentCurrentFileReader {
  return { findForApprovedParticipant: jest.fn().mockResolvedValue(file) };
}

async function sha256(body: Readable): Promise<string> {
  return createHash('sha256')
    .update(await buffer(body))
    .digest('hex');
}

describe('MilestoneDocumentCurrentFileService', () => {
  it.each([
    'cross-team',
    'unauthorized-private-file',
    'wrong-program',
    'wrong-document',
    'text-submission',
    'nonexistent',
    'missing-submission',
    'replaced-file',
    'deleted-file',
    'expired-file',
  ])('%s를 존재하지 않는 파일과 같은 MSD_020 404로 감춘다', async () => {
    // Given
    const get = jest.fn(() =>
      Promise.resolve(Readable.from(Buffer.from('unused'))),
    );
    const storage = buildStorage(get);
    const service = new MilestoneDocumentCurrentFileService(
      buildReader(null),
      storage,
    );

    // When / Then
    await expect(
      service.download(34_290_000n, 'milestone-hidden', 'document-hidden'),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND,
        status: 404,
      },
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('현재 첨부가 교체되면 다음 다운로드는 새 bytes만 돌려준다', async () => {
    // Given: 첫 제출 파일을 받은 뒤 같은 제출 행에 새 파일이 현재 첨부로 붙는다.
    let current = CURRENT_FILE;
    const reader: MilestoneDocumentCurrentFileReader = {
      findForApprovedParticipant: jest.fn(() => Promise.resolve(current)),
    };
    const bytesByKey = new Map([
      ['objects/current', Buffer.from('current-bytes')],
      ['objects/replacement', Buffer.from('replacement-bytes')],
    ]);
    const get = jest.fn((key: string) =>
      Promise.resolve(Readable.from(bytesByKey.get(key) ?? Buffer.alloc(0))),
    );
    const service = new MilestoneDocumentCurrentFileService(
      reader,
      buildStorage(get),
    );

    // When: 첫 파일을 받고 현재 첨부를 교체한 뒤 다시 받는다.
    const first = await service.download(
      34_290_000n,
      'milestone-current',
      'document-current',
    );
    current = {
      storageKey: 'objects/replacement',
      originalFileName: 'replacement.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 17,
    };
    const replacement = await service.download(
      34_290_000n,
      'milestone-current',
      'document-current',
    );

    // Then
    await expect(sha256(first.body)).resolves.toBe(
      createHash('sha256').update('current-bytes').digest('hex'),
    );
    await expect(sha256(replacement.body)).resolves.toBe(
      createHash('sha256').update('replacement-bytes').digest('hex'),
    );
    expect(get).toHaveBeenNthCalledWith(1, 'objects/current');
    expect(get).toHaveBeenNthCalledWith(2, 'objects/replacement');
  });

  it('저장된 이름을 다시 위생 처리하고 허용되지 않은 MIME은 octet-stream으로 내린다', async () => {
    // Given
    const service = new MilestoneDocumentCurrentFileService(
      buildReader({
        ...CURRENT_FILE,
        originalFileName: '../../current.pdf',
        mimeType: 'text/html',
      }),
      buildStorage(),
    );

    // When
    const result = await service.download(
      34_290_000n,
      'milestone-current',
      'document-current',
    );

    // Then
    expect(result.fileName).toBe('current.pdf');
    expect(result.contentType).toBe('application/octet-stream');
    expect(result).not.toHaveProperty('storageKey');
    expect(result).not.toHaveProperty('uploaderId');
    expect(result).not.toHaveProperty('revision');
  });

  it('스토리지 오류 원문을 노출하지 않고 MSD_012로 감싼다', async () => {
    // Given
    const service = new MilestoneDocumentCurrentFileService(
      buildReader(CURRENT_FILE),
      buildStorage(() => Promise.reject(new Error('synthetic raw error'))),
    );

    // When / Then
    await expect(
      service.download(34_290_000n, 'milestone-current', 'document-current'),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE,
      },
    });
  });
});
