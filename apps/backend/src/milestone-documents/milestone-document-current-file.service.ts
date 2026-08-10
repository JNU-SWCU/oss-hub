import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { DomainException } from '../common/error-code';
import { safeSubmissionFileContentType } from '../submissions/submission-file-content-type';
import { sanitizeSubmissionFileOriginalName } from '../submissions/submission-file-name';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from '../submissions/submission-file-storage.port';
import {
  MilestoneDocumentCurrentFileRepository,
  type MilestoneDocumentCurrentFileReader,
} from './milestone-document-current-file.repository';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';

export interface DownloadedMilestoneDocumentCurrentFile {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}

@Injectable()
export class MilestoneDocumentCurrentFileService {
  constructor(
    @Inject(MilestoneDocumentCurrentFileRepository)
    private readonly repository: MilestoneDocumentCurrentFileReader,
    @Inject(SUBMISSION_FILE_STORAGE)
    private readonly storage: SubmissionFileStoragePort,
  ) {}

  async download(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<DownloadedMilestoneDocumentCurrentFile> {
    const file = await this.repository.findForApprovedParticipant(
      sessionGithubId,
      milestoneId,
      documentId,
    );
    if (file === null) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }

    let body: Readable;
    try {
      body = await this.storage.get(file.storageKey);
    } catch {
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    const fileName = sanitizeSubmissionFileOriginalName(file.originalFileName);
    return {
      body,
      fileName,
      contentType: safeSubmissionFileContentType(fileName, file.mimeType),
      contentLength: file.sizeBytes,
    };
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
