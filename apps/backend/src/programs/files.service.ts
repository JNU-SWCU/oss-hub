import {
  Injectable,
  Inject,
  Optional,
  BadRequestException,
  ConflictException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import {
  ReviewDecision,
  SubmissionStatus,
  RequirementSubmissionType,
} from '@prisma/client';
import { ProgramScheduleService } from './program-schedule.service';
import {
  ValidatedProgramAuthoringUpload,
  type ProgramExternalCover,
  ProgramAuthoringUploadToken,
  type UploadedMilestoneDocumentFileResponse,
  type MilestoneDocumentFileUpload,
  type UploadedMilestoneDocumentTemplateResponse,
  type DownloadedMilestoneDocumentTemplate,
  type DownloadedMilestoneDocumentSubmissionFile,
} from './files.config';
import { type ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import {
  ProgramAuthoringUploadRepository,
  type ProgramAuthoringUploadDeleteRequestResult,
  type CreatePendingSubmissionFileInput,
  FilesRepository,
} from './files.repository';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
  type ProgramAuthoringUploadResponse,
  SubmissionFileQuotaExceededError,
  SubmissionFileRetentionUnavailableError,
} from './files.error';
import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  PROGRAM_COVER_MAX_BYTES,
  SUBMISSION_FILE_EXTENSIONS,
} from './submission-upload.config';
import { ProgramAuthoringUploadTokenError } from './program-authoring.error';
import { PROGRAM_COVER_STORAGE_PREFIX } from './program-cover.config';
import { DomainException } from '../platform/error-code.error';
import { ProgramAuthoringValidationError } from './program-authoring-validation.error';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { randomUUID, createHash } from 'node:crypto';
import { extname } from 'node:path';
import { type Response } from 'express';
import { DownloadResponseService } from './download-response.service';
import { type Readable } from 'node:stream';
import {
  OBJECT_STORAGE_ERROR_CODES,
  ObjectStorageError,
} from '../platform/object-storage.error';
import {
  SUBMISSION_ZIP_REJECTION_ERROR_CODES,
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import {
  SubmissionZipRejection,
  MAX_ENTRY_COUNT,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
} from './submission-zip.error';
import { fromBufferPromise, type Entry } from 'yauzl';
import { UserProfileService } from '../users/user-profile.service';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import {
  MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES,
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import { RequirementsRepository } from './requirements.repository';
@Injectable()
export class MilestoneDocumentSubmissionWindowService {
  constructor(
    private readonly programScheduleService: ProgramScheduleService,
  ) {}

  isResubmissionAllowedAfter(latestDecision: ReviewDecision | null): boolean {
    if (latestDecision === null) return true;
    switch (latestDecision) {
      case ReviewDecision.APPROVED:
      case ReviewDecision.REJECTED:
        return false;
      case ReviewDecision.CHANGES_REQUESTED:
        return true;
    }
  }

  isChangeRequestResubmissionOpen({
    latestDecision,
    submissionStatus,
  }: {
    readonly latestDecision: ReviewDecision | null;
    readonly submissionStatus: SubmissionStatus | null;
  }): boolean {
    return (
      latestDecision === ReviewDecision.CHANGES_REQUESTED &&
      submissionStatus === SubmissionStatus.CHANGES_REQUESTED
    );
  }

  milestoneDocumentSubmissionBlock({
    dueAt,
    graceDueAt = null,
    now,
    hasSubmission,
    latestDecision,
    submissionStatus,
  }: {
    readonly dueAt: Date;
    readonly graceDueAt?: Date | null;
    readonly now: Date;
    readonly hasSubmission: boolean;
    readonly latestDecision: ReviewDecision | null;

    readonly submissionStatus: SubmissionStatus | null;
  }): MilestoneDocumentSubmissionBlock | null {
    if (
      latestDecision === ReviewDecision.APPROVED ||
      latestDecision === ReviewDecision.REJECTED
    ) {
      return 'RESUBMISSION_NOT_ALLOWED';
    }
    if (!this.programScheduleService.hasProgramDeadlinePassed(dueAt, now))
      return null;
    if (
      this.isChangeRequestResubmissionOpen({ latestDecision, submissionStatus })
    ) {
      return null;
    }

    if (latestDecision === ReviewDecision.CHANGES_REQUESTED && hasSubmission) {
      return 'RESUBMISSION_ALREADY_USED';
    }
    if (
      latestDecision === null &&
      graceDueAt !== null &&
      !this.programScheduleService.hasProgramDeadlinePassed(graceDueAt, now)
    )
      return null;
    return hasSubmission ? 'SUBMISSION_REPLACEMENT_CLOSED' : 'MILESTONE_CLOSED';
  }
}

export type MilestoneDocumentSubmissionBlock =
  | 'MILESTONE_CLOSED'
  | 'SUBMISSION_REPLACEMENT_CLOSED'
  | 'RESUBMISSION_NOT_ALLOWED'
  | 'RESUBMISSION_ALREADY_USED';
@Injectable()
export class MilestoneDocumentFileNameService {
  milestoneDocumentDownloadFileName(
    input: MilestoneDocumentDownloadFileNameInput,
  ): string {
    return `${baseName(input)}${extensionOf(input.originalFileName)}`;
  }

  milestoneDocumentTextEntryFileName(
    input: Omit<MilestoneDocumentDownloadFileNameInput, 'originalFileName'>,
  ): string {
    return `${baseName(input)}.txt`;
  }

  milestoneDocumentArchiveFolderName(value: string): string {
    const segment = safeSegment(value);

    const stem = segment.split('.')[0] ?? segment;
    return WINDOWS_RESERVED_NAMES.has(normalizeDeviceDigits(stem).toUpperCase())
      ? `${segment}_`
      : segment;
  }
}

const UNSAFE_CHARACTERS = new Set([
  '/',
  '\\',
  ':',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
  ';',
  ',',
  "'",
]);

const FALLBACK_SEGMENT = 'file';

const MAX_SEGMENT_UNITS = 100;

const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_unused, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_unused, index) => `LPT${index + 1}`),
]);

function normalizeDeviceDigits(value: string): string {
  return value.replace(/[¹²³]/g, (character) =>
    String({ '¹': 1, '²': 2, '³': 3 }[character] ?? character),
  );
}

function baseName(
  input: Omit<MilestoneDocumentDownloadFileNameInput, 'originalFileName'>,
): string {
  return `${safeSegment(input.teamName)}_${safeSegment(input.documentName)}`;
}

function replaceUnsafe(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;

      if (code < 0x20 || code === 0x7f) return '_';
      if (isInvisibleFormatting(code)) return '_';
      return UNSAFE_CHARACTERS.has(character) ? '_' : character;
    })
    .join('');
}

function isInvisibleFormatting(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function safeSegment(value: string): string {
  const normalized = truncate(replaceUnsafe(value).replace(/\s+/g, ' ').trim())
    .replace(/\.+$/, '')
    .trim();

  if (normalized.length === 0 || /^\.+$/.test(normalized)) {
    return FALLBACK_SEGMENT;
  }
  return normalized;
}

function truncate(value: string): string {
  if (value.length <= MAX_SEGMENT_UNITS) return value;
  let units = 0;
  let cut = '';
  for (const character of value) {
    if (units + character.length > MAX_SEGMENT_UNITS) break;
    units += character.length;
    cut += character;
  }
  return cut.trim();
}

function extensionOf(originalFileName: string): string {
  const dot = originalFileName.lastIndexOf('.');
  if (dot <= 0 || dot === originalFileName.length - 1) return '';
  const extension = replaceUnsafe(originalFileName.slice(dot + 1)).replace(
    /\s+/g,
    '',
  );
  return extension.length > 0 ? `.${extension}` : '';
}

export interface MilestoneDocumentDownloadFileNameInput {
  readonly teamName: string;
  readonly documentName: string;
  readonly originalFileName: string;
}
const LATIN1_MAX_CODE_POINT = 0xff;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

@Injectable()
export class SubmissionFileAdmissionService {
  normalizeMultipartFileName(fileName: string): string {
    if (
      [...fileName].some(
        (character) => character.codePointAt(0)! > LATIN1_MAX_CODE_POINT,
      )
    ) {
      return fileName.normalize('NFC');
    }

    try {
      return UTF8_DECODER.decode(Buffer.from(fileName, 'latin1')).normalize(
        'NFC',
      );
    } catch {
      return fileName.normalize('NFC');
    }
  }

  safeSubmissionFileContentType(fileName: string): string {
    const extension = submissionFileExtension(fileName);
    return extension === null
      ? 'application/octet-stream'
      : (CANONICAL_CONTENT_TYPES[extension] ?? 'application/octet-stream');
  }

  isAllowedSubmissionFileType(fileName: string): boolean {
    const extension = submissionFileExtension(fileName);
    return extension !== null && ALLOWED_SUBMISSION_EXTENSIONS.has(extension);
  }

  createSubmissionFileObjectKey(): string {
    return `submission-files/${randomUUID()}`;
  }

  sanitizeSubmissionFileOriginalName(name: string): string {
    const baseName = name.replaceAll('\\', '/').split('/').at(-1) ?? '';
    const sanitized = [...baseName]
      .filter(IS_SAFE_CHARACTER)
      .join('')
      .trim()
      .slice(0, MAX_ORIGINAL_NAME_LENGTH);

    return sanitized.length > 0 && sanitized !== '.' && sanitized !== '..'
      ? sanitized
      : 'file';
  }

  hasValidSubmissionFileSignature(buffer: Buffer, fileName: string): boolean {
    const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    return (
      FILE_SIGNATURES[extension]?.some(
        (signature) =>
          buffer.length >= signature.length &&
          buffer.subarray(0, signature.length).equals(signature),
      ) ?? false
    );
  }

  hasValidSubmissionTemplateSignature(
    buffer: Buffer,
    fileName: string,
  ): boolean {
    const dot = fileName.lastIndexOf('.');
    if (dot <= 0) return false;
    const signature = IMAGE_SIGNATURES[fileName.slice(dot).toLowerCase()];
    return signature === undefined
      ? this.hasValidSubmissionFileSignature(buffer, fileName)
      : buffer.subarray(0, signature.length).equals(signature);
  }

  async inspectSubmissionZipMetadata(
    buffer: Buffer,
  ): Promise<SubmissionZipRejection | null> {
    try {
      const zipFile = await fromBufferPromise(buffer, {
        decodeStrings: true,
        strictFileNames: true,
        validateEntrySizes: true,
      });
      if (zipFile.entryCount > MAX_ENTRY_COUNT) {
        return SubmissionZipRejection.TOO_MANY_ENTRIES;
      }

      let entryCount = 0;
      let totalCompressedBytes = 0;
      let totalUncompressedBytes = 0;
      for await (const entry of zipFile.eachEntry()) {
        entryCount += 1;
        const entryRejection = inspectEntry(entry);
        if (entryRejection !== null) return entryRejection;

        totalCompressedBytes += entry.compressedSize;
        totalUncompressedBytes += entry.uncompressedSize;
        if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
          return SubmissionZipRejection.CONTENT_TOO_LARGE;
        }
        if (
          exceedsCompressionRatio(totalUncompressedBytes, totalCompressedBytes)
        ) {
          return SubmissionZipRejection.EXPANDS_TOO_MUCH;
        }
      }

      return entryCount === zipFile.entryCount
        ? null
        : SubmissionZipRejection.UNREADABLE;
    } catch {
      return SubmissionZipRejection.UNREADABLE;
    }
  }
}

const CANONICAL_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.hwp': 'application/x-hwp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

function submissionFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  return fileName.slice(dot).toLowerCase();
}

const ALLOWED_SUBMISSION_EXTENSIONS = new Set<string>(
  SUBMISSION_FILE_EXTENSIONS,
);

const MAX_ORIGINAL_NAME_LENGTH = 255;

const IS_SAFE_CHARACTER = (character: string): boolean => {
  const characterCode = character.charCodeAt(0);
  return characterCode > 0x1f && characterCode !== 0x7f;
};

const FILE_SIGNATURES: Readonly<Record<string, readonly Buffer[]>> = {
  '.pdf': [Buffer.from('%PDF-')],
  '.hwp': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  '.zip': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ],
};

const IMAGE_SIGNATURES: Readonly<Record<string, Buffer>> = {
  '.jpg': Buffer.from([0xff, 0xd8, 0xff]),
  '.jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  '.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

const MAX_COMPRESSION_RATIO = 100;

const UNIX_HOST_SYSTEM = 3;

const UNIX_FILE_TYPE_MASK = 0xf000;

const UNIX_SYMLINK_TYPE = 0xa000;

function inspectEntry(entry: Entry): SubmissionZipRejection | null {
  const fileName = entry.fileName.toLowerCase();
  if (entry.fileName.includes('\u0000')) {
    return SubmissionZipRejection.ENTRY_NOT_ALLOWED;
  }
  if (fileName.endsWith('.zip')) return SubmissionZipRejection.NESTED_ARCHIVE;
  if (isUnixSymlink(entry)) return SubmissionZipRejection.ENTRY_NOT_ALLOWED;
  if (entry.isEncrypted()) return SubmissionZipRejection.PASSWORD_PROTECTED;
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    return SubmissionZipRejection.UNSUPPORTED_COMPRESSION;
  }
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    return SubmissionZipRejection.CONTENT_TOO_LARGE;
  }
  if (exceedsCompressionRatio(entry.uncompressedSize, entry.compressedSize)) {
    return SubmissionZipRejection.EXPANDS_TOO_MUCH;
  }
  return null;
}

function isUnixSymlink(entry: Entry): boolean {
  const hostSystem = entry.versionMadeBy >>> 8;
  const unixFileType =
    (entry.externalFileAttributes >>> 16) & UNIX_FILE_TYPE_MASK;
  return hostSystem === UNIX_HOST_SYSTEM && unixFileType === UNIX_SYMLINK_TYPE;
}

function exceedsCompressionRatio(
  uncompressedBytes: number,
  compressedBytes: number,
): boolean {
  return uncompressedBytes > compressedBytes * MAX_COMPRESSION_RATIO;
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1_000;

type ProgramAuthoringUploadStore = Pick<
  ProgramAuthoringUploadRepository,
  'createPending' | 'requestDelete'
>;
type ProgramAuthoringUploadStorage = Pick<ObjectStoragePort, 'put'>;

@Injectable()
export class ProgramAuthoringUploadService {
  constructor(
    @Inject(ProgramAuthoringUploadRepository)
    private readonly repository: ProgramAuthoringUploadStore,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ProgramAuthoringUploadStorage,
    private readonly submissionFileAdmissionService: SubmissionFileAdmissionService,
    private readonly noticeClient: ProgramNoticeFetchClient,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

  createProgramAuthoringObjectKey(): string {
    return `program-authoring/${randomUUID()}`;
  }

  async validateProgramAuthoringUpload(
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ValidatedProgramAuthoringUpload> {
    if (
      file === undefined ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.byteLength === 0 ||
      file.size !== file.buffer.byteLength
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_FILE,
      );
    }
    if (file.buffer.byteLength > PROGRAM_AUTHORING_UPLOAD_MAX_BYTES) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
      );
    }

    const originalFileName =
      this.submissionFileAdmissionService.sanitizeSubmissionFileOriginalName(
        this.submissionFileAdmissionService.normalizeMultipartFileName(
          file.originalname,
        ),
      );
    if (
      !this.submissionFileAdmissionService.hasValidSubmissionTemplateSignature(
        file.buffer,
        originalFileName,
      )
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    if (
      originalFileName.toLowerCase().endsWith('.zip') &&
      (await this.submissionFileAdmissionService.inspectSubmissionZipMetadata(
        file.buffer,
      )) !== null
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    return {
      body: file.buffer,
      originalFileName,
      mimeType: file.mimetype.toLowerCase(),
      sizeBytes: file.buffer.byteLength,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  createProgramCoverObjectKey(): string {
    return `${PROGRAM_COVER_STORAGE_PREFIX}${randomUUID()}`;
  }

  validateProgramCoverUpload(
    file: ProgramAuthoringUploadFile | undefined,
  ): ValidatedProgramAuthoringUpload {
    if (
      file === undefined ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.byteLength === 0 ||
      file.size !== file.buffer.byteLength
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_FILE,
      );
    }
    if (file.size > PROGRAM_COVER_MAX_BYTES) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
      );
    }
    const originalFileName =
      this.submissionFileAdmissionService.sanitizeSubmissionFileOriginalName(
        this.submissionFileAdmissionService.normalizeMultipartFileName(
          file.originalname,
        ),
      );
    const extension = extname(originalFileName).toLowerCase();
    const mimeType =
      extension === '.png'
        ? 'image/png'
        : extension === '.jpg' || extension === '.jpeg'
          ? 'image/jpeg'
          : null;
    if (
      mimeType === null ||
      file.mimetype.toLowerCase() !== mimeType ||
      !this.submissionFileAdmissionService.hasValidSubmissionTemplateSignature(
        file.buffer,
        originalFileName,
      )
    ) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }
    return {
      body: file.buffer,
      originalFileName,
      mimeType,
      sizeBytes: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  validateProgramCoverChoice(input: {
    readonly coverUploadId?: string | null;
    readonly externalCover?: ProgramExternalCover | null;
  }): ProgramExternalCover | null | undefined {
    if (
      input.coverUploadId !== undefined &&
      input.externalCover !== undefined
    ) {
      throw new ProgramAuthoringValidationError([
        { path: 'externalCover', code: 'CONFLICTING_COVER_CHOICES' },
      ]);
    }
    if (input.externalCover == null) return input.externalCover;
    try {
      const source = this.noticeClient.parseProgramNoticeUrl(
        input.externalCover.sourceUrl,
      );
      const image = this.noticeClient.parseProgramNoticeImageUrl(
        input.externalCover.imageUrl,
        source,
      );
      if (image !== null)
        return { sourceUrl: source.href, imageUrl: image.href };
    } catch (error) {
      if (!(error instanceof DomainException)) throw error;
    }
    throw new ProgramAuthoringValidationError([
      { path: 'externalCover', code: 'INVALID_EXTERNAL_COVER' },
    ]);
  }

  assertProgramTemplateUpload(upload: ProgramAuthoringUploadToken): void {
    if (!upload.storageKey.startsWith('program-authoring/')) {
      throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
    }
  }

  assertProgramCoverUpload(upload: ProgramAuthoringUploadToken): void {
    if (
      !upload.storageKey.startsWith(PROGRAM_COVER_STORAGE_PREFIX) ||
      !['image/jpeg', 'image/png'].includes(upload.mimeType) ||
      upload.sizeBytes < 1 ||
      upload.sizeBytes > PROGRAM_COVER_MAX_BYTES
    ) {
      throw new ProgramAuthoringUploadTokenError('WRONG_PURPOSE', [upload.id]);
    }
  }

  async uploadFromRequest(
    actorId: string,
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponse> {
    try {
      return await this.upload(actorId, file);
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  async uploadCoverFromRequest(
    actorId: string,
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponse> {
    try {
      return await this.uploadCover(actorId, file);
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  async deleteFromRequest(actorId: string, id: string): Promise<void> {
    try {
      await this.delete(actorId, id);
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  async upload(
    actorId: string,
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponse> {
    if (!isOpaqueId(actorId)) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_ACTOR,
      );
    }
    const validated = await this.validateProgramAuthoringUpload(file);
    return this.storeUpload(actorId, validated, () =>
      this.createProgramAuthoringObjectKey(),
    );
  }

  async uploadCover(
    actorId: string,
    file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponse> {
    if (!isOpaqueId(actorId)) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_ACTOR,
      );
    }
    return this.storeUpload(
      actorId,
      this.validateProgramCoverUpload(file),
      () => this.createProgramCoverObjectKey(),
    );
  }

  private async storeUpload(
    actorId: string,
    validated: ValidatedProgramAuthoringUpload,
    createObjectKey: () => string,
  ): Promise<ProgramAuthoringUploadResponse> {
    const createdAt = this.now();
    const storageKey = createObjectKey();

    let created;
    try {
      created = await this.repository.createPending({
        actorId,
        storageKey,
        originalFileName: validated.originalFileName,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
        expiresAt: new Date(createdAt.getTime() + PENDING_TTL_MS),
      });
    } catch {
      throw this.unavailable();
    }

    try {
      await this.storage.put({
        body: validated.body,
        contentType: validated.mimeType,
        originalName: validated.originalFileName,
        objectKey: storageKey,
      });
    } catch {
      throw this.unavailable();
    }

    return {
      id: created.id,
      fileName: created.originalFileName,
      contentType: created.mimeType,
      size: created.sizeBytes,
      expiresAt: created.expiresAt.toISOString(),
    };
  }

  async delete(actorId: string, id: string): Promise<void> {
    if (!isOpaqueId(actorId) || !isOpaqueId(id)) {
      throw new ProgramAuthoringUploadError(
        PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.NOT_FOUND,
      );
    }
    const result = await this.repository.requestDelete(actorId, id, this.now());
    this.handleDeleteResult(result);
  }

  private handleDeleteResult(
    result: ProgramAuthoringUploadDeleteRequestResult,
  ): void {
    switch (result.kind) {
      case 'QUEUED':
      case 'IDEMPOTENT':
        return;
      case 'NOT_FOUND':
        throw new ProgramAuthoringUploadError(
          PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.NOT_FOUND,
        );
      case 'ATTACHED':
        throw new ProgramAuthoringUploadError(
          PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.ATTACHED_CONFLICT,
        );
    }
  }

  private unavailable(): ProgramAuthoringUploadError {
    return new ProgramAuthoringUploadError(
      PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.STORAGE_UNAVAILABLE,
    );
  }
}

function isOpaqueId(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

function uploadHttpError(error: unknown): Error {
  if (!(error instanceof ProgramAuthoringUploadError)) throw error;
  switch (error.code) {
    case 'PROGRAM_AUTHORING_UPLOAD_NOT_FOUND':
      return new NotFoundException('Upload was not found.');
    case 'PROGRAM_AUTHORING_UPLOAD_ATTACHED_CONFLICT':
      return new ConflictException('Upload is already attached.');
    case 'PROGRAM_AUTHORING_UPLOAD_STORAGE_UNAVAILABLE':
      return new ConflictException('Upload storage is currently unavailable.');
    case 'PROGRAM_AUTHORING_UPLOAD_INVALID_ACTOR':
    case 'PROGRAM_AUTHORING_UPLOAD_INVALID_FILE':
    case 'PROGRAM_AUTHORING_UPLOAD_FILE_TOO_LARGE':
    case 'PROGRAM_AUTHORING_UPLOAD_UNSUPPORTED_FILE_TYPE':
      return new BadRequestException('Upload is invalid.');
  }
}

export const PROGRAM_AUTHORING_UPLOAD_MAX_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;

export interface SubmissionFileUpload {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

export interface DownloadedSubmissionFile {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}
export const MAX_FILE_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;
@Injectable()
export class FilesService {
  constructor(
    private readonly repository: FilesRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    private readonly programScheduleService: ProgramScheduleService,
    private readonly submissionFileAdmissionService: SubmissionFileAdmissionService,
    private readonly downloadResponseService: DownloadResponseService,
  ) {}
  async downloadTo(
    response: Response,
    sessionGithubId: bigint,
    fileId: string,
  ): Promise<StreamableFile> {
    const file = await this.download(sessionGithubId, fileId);
    response.setHeader('Cache-Control', 'private, no-store');
    return this.downloadResponseService.streamableFile(response, file);
  }
  createPending(
    input: Omit<CreatePendingSubmissionFileInput, 'resolveExpiresAt'>,
  ) {
    return this.repository.createPending({
      ...input,
      resolveExpiresAt: (programEndAt) =>
        this.programScheduleService.addOneCalendarYear(programEndAt),
    });
  }
  async check(file: SubmissionFileUpload | undefined): Promise<void> {
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw this.error(SubmissionsErrorCode.INVALID_FILE_UPLOAD);
    }
    await this.admitFile(file);
  }
  private async admitFile(file: SubmissionFileUpload): Promise<string> {
    if (file.size > MAX_FILE_BYTES || file.buffer.byteLength > MAX_FILE_BYTES) {
      throw this.error(SubmissionsErrorCode.FILE_TOO_LARGE);
    }
    const normalizedFileName =
      this.submissionFileAdmissionService.normalizeMultipartFileName(
        file.originalname,
      );
    if (
      !this.submissionFileAdmissionService.isAllowedSubmissionFileType(
        normalizedFileName,
      ) ||
      !this.submissionFileAdmissionService.hasValidSubmissionFileSignature(
        file.buffer,
        normalizedFileName,
      )
    ) {
      throw this.error(SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE);
    }
    if (normalizedFileName.toLowerCase().endsWith('.zip')) {
      const zipRejection =
        await this.submissionFileAdmissionService.inspectSubmissionZipMetadata(
          file.buffer,
        );
      if (zipRejection !== null) {
        throw this.error(SUBMISSION_ZIP_REJECTION_ERROR_CODES[zipRejection]);
      }
    }
    return normalizedFileName;
  }
  async download(
    sessionGithubId: bigint,
    fileId: string,
    now: Date = new Date(),
  ): Promise<DownloadedSubmissionFile> {
    if (fileId.length === 0 || fileId !== fileId.trim()) {
      throw this.error(SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }
    const file = await this.repository.findDownloadableFile(
      sessionGithubId,
      fileId,
      now,
    );
    if (file === null) {
      throw this.error(SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }
    let body: Readable;
    try {
      body = await this.storage.get(file.storageKey);
    } catch (error) {
      if (
        error instanceof ObjectStorageError &&
        error.code === OBJECT_STORAGE_ERROR_CODES.GET_NOT_FOUND
      ) {
        throw this.error(SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND);
      }
      throw this.error(SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }
    return {
      body,
      fileName: file.originalFileName,
      contentType:
        this.submissionFileAdmissionService.safeSubmissionFileContentType(
          file.originalFileName,
        ),
      contentLength: file.sizeBytes,
    };
  }
  private error(code: SubmissionsErrorCode): DomainException {
    return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
  }
}

@Injectable()
export class MilestoneDocumentFilesService {
  constructor(
    private readonly repository: RequirementsRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    private readonly submissionFiles: FilesService,
    private readonly milestoneDocumentSubmissionWindowService: MilestoneDocumentSubmissionWindowService,
    private readonly milestoneDocumentFileNameService: MilestoneDocumentFileNameService,
    private readonly submissionFileAdmissionService: SubmissionFileAdmissionService,
    private readonly downloadResponseService: DownloadResponseService,
    private readonly userProfileService: UserProfileService,
  ) {}

  async downloadTemplateTo(
    response: Response,
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<StreamableFile> {
    const file = await this.downloadTemplate(
      sessionGithubId,
      milestoneId,
      documentId,
    );
    return this.downloadResponseService.streamableFile(response, file);
  }

  async downloadSubmissionFileTo(
    response: Response,
    milestoneId: string,
    documentId: string,
    teamId: string,
  ): Promise<StreamableFile> {
    const file = await this.downloadSubmissionFile(
      milestoneId,
      documentId,
      teamId,
    );
    return this.downloadResponseService.streamableFile(response, file);
  }

  async upload(
    sessionGithubId: bigint,
    milestoneId: unknown,
    documentId: unknown,
    file: MilestoneDocumentFileUpload | undefined,
    now: Date = new Date(),
  ): Promise<UploadedMilestoneDocumentFileResponse> {
    const normalizedMilestoneId = this.requiredOpaqueId(milestoneId);
    const normalizedDocumentId = this.requiredOpaqueId(documentId);
    const originalName = await this.validateOriginalFileName(file);
    const uploadedFile = file as MilestoneDocumentFileUpload;

    const viewer =
      await this.repository.findActiveStudentByGithubId(sessionGithubId);
    if (viewer === null) {
      throw this.error(MilestoneDocumentsErrorCode.STUDENT_ONLY);
    }

    const documentContext =
      await this.repository.findDocumentContext(normalizedDocumentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== normalizedMilestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
    const application = await this.repository.findStudentApplication(
      viewer.id,
      documentContext.programId,
    );
    if (application === null) {
      throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
    }
    if (!application.approved) {
      throw this.error(
        MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED,
      );
    }

    switch (documentContext.submissionType) {
      case RequirementSubmissionType.TEXT:
        throw this.error(MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH);
      case RequirementSubmissionType.FILE:
      case RequirementSubmissionType.FILE_OR_TEXT:
        break;
      default:
        throw new TypeError(
          `Unknown requirement input rule: ${String(documentContext.submissionType satisfies never)}`,
        );
    }

    const [currentSubmission, latestReview] = await Promise.all([
      this.repository.findMySubmission(
        normalizedDocumentId,
        application.teamId,
      ),
      this.repository.findLatestReview(
        normalizedDocumentId,
        application.teamId,
      ),
    ]);

    const blocked =
      this.milestoneDocumentSubmissionWindowService.milestoneDocumentSubmissionBlock(
        {
          dueAt: documentContext.dueAt,
          graceDueAt: documentContext.graceDueAt,
          now,
          hasSubmission: currentSubmission !== null,
          latestDecision: latestReview?.decision ?? null,
          submissionStatus: currentSubmission?.status ?? null,
        },
      );
    if (blocked !== null) {
      throw this.error(MilestoneDocumentsErrorCode[blocked]);
    }

    const objectKey =
      this.submissionFileAdmissionService.createSubmissionFileObjectKey();

    let created;
    try {
      created = await this.submissionFiles.createPending({
        uploaderId: viewer.id,
        teamId: application.teamId,
        milestoneId: normalizedMilestoneId,
        milestoneDocumentId: normalizedDocumentId,
        storageKey: objectKey,
        originalFileName: originalName,
        mimeType: uploadedFile.mimetype,
        sizeBytes: uploadedFile.buffer.byteLength,
        pendingExpiresAt: new Date(now.getTime() + PENDING_TTL_MS),
      });
    } catch (error) {
      if (error instanceof SubmissionMembershipChangedError) {
        throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
      }
      if (error instanceof SubmissionFileQuotaExceededError) {
        throw this.error(
          MilestoneDocumentsErrorCode.SUBMISSION_FILE_QUOTA_EXCEEDED,
        );
      }
      if (error instanceof SubmissionFileRetentionUnavailableError) {
        throw this.error(
          MilestoneDocumentsErrorCode.FILE_RETENTION_UNAVAILABLE,
        );
      }
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    try {
      await this.storage.put({
        body: uploadedFile.buffer,
        contentType: uploadedFile.mimetype,
        originalName,
        objectKey,
      });
    } catch {
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    return {
      fileId: created.id,
      fileName: created.originalFileName,
      contentType: created.mimeType,
      size: created.sizeBytes,
      expiresAt: created.expiresAt.toISOString(),
    };
  }

  async check(file: MilestoneDocumentFileUpload | undefined): Promise<void> {
    await this.validateOriginalFileName(file);
  }

  async uploadTemplate(
    actorId: string,
    milestoneId: string,
    documentId: string,
    file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentTemplateResponse> {
    const originalName = await this.validateOriginalFileName(file, 'TEMPLATE');
    const uploadedFile = file as MilestoneDocumentFileUpload;

    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const objectKey =
      this.submissionFileAdmissionService.createSubmissionFileObjectKey();
    const now = new Date();

    try {
      await this.storage.put({
        body: uploadedFile.buffer,
        contentType: uploadedFile.mimetype,
        originalName,
        objectKey,
      });
    } catch {
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    await this.repository.withTransaction(async (store) => {
      const lockedDocument = await store.lockDocument(documentId);
      if (
        lockedDocument === null ||
        lockedDocument.milestoneId !== milestoneId
      ) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }

      await store.upsertTemplateFile({
        milestoneDocumentId: documentId,
        uploadedById: actorId,
        storageKey: objectKey,
        originalFileName: originalName,
        mimeType: uploadedFile.mimetype,
        sizeBytes: uploadedFile.buffer.byteLength,
        uploadedAt: now,
      });
    });

    return {
      documentId,
      hasTemplateFile: true,
      fileName: originalName,
      uploadedAt: now.toISOString(),
    };
  }

  async downloadTemplate(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<DownloadedMilestoneDocumentTemplate> {
    const viewer = await this.repository.findActiveUser(sessionGithubId);
    if (viewer === null) {
      throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
    }

    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    if (
      !this.userProfileService.isStaffEligible({
        accountStatus: viewer.accountStatus,
        memberKind: viewer.type === 'UNSELECTED' ? null : viewer.type,
        hasStaffAccess:
          viewer.type === 'STAFF' && viewer.approvalStatus === 'APPROVED',
        isProfileComplete:
          viewer.profileCreatedAt !== null &&
          this.userProfileService.isCompleteProfileFields(
            { ...viewer, studentId: null },
            'STAFF',
          ),
      })
    ) {
      const application = await this.repository.findStudentApplication(
        viewer.id,
        documentContext.programId,
      );
      if (application === null) {
        throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
      }
    }

    const template = await this.repository.findTemplateForDownload(documentId);
    if (template === null) {
      throw this.error(MilestoneDocumentsErrorCode.TEMPLATE_NOT_FOUND);
    }

    let body: Readable;
    try {
      body = await this.storage.get(template.storageKey);
    } catch {
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    return {
      body,
      fileName: template.originalFileName,
      contentType:
        this.submissionFileAdmissionService.safeSubmissionFileContentType(
          template.originalFileName,
        ),
      contentLength: template.sizeBytes,
    };
  }

  async downloadSubmissionFile(
    milestoneId: string,
    documentId: string,
    teamId: string,
    now: Date = new Date(),
  ): Promise<DownloadedMilestoneDocumentSubmissionFile> {
    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const applicationProgramId =
      await this.repository.findApplicationProgramId(teamId);
    if (applicationProgramId !== documentContext.programId) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }

    const file = await this.repository.findSubmissionFileForStaffDownload(
      documentId,
      teamId,
      now,
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

    return {
      body,
      fileName:
        this.milestoneDocumentFileNameService.milestoneDocumentDownloadFileName(
          {
            teamName: file.teamName,
            documentName: documentContext.name,
            originalFileName: file.originalFileName,
          },
        ),
      contentType:
        this.submissionFileAdmissionService.safeSubmissionFileContentType(
          file.originalFileName,
        ),
      contentLength: file.sizeBytes,
    };
  }

  private async validateOriginalFileName(
    file: MilestoneDocumentFileUpload | undefined,
    purpose: 'STUDENT' | 'TEMPLATE' = 'STUDENT',
  ): Promise<string> {
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw this.error(MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD);
    }
    if (file.size > MAX_FILE_BYTES || file.buffer.byteLength > MAX_FILE_BYTES) {
      throw this.error(MilestoneDocumentsErrorCode.FILE_TOO_LARGE);
    }
    const normalizedFileName =
      this.submissionFileAdmissionService.normalizeMultipartFileName(
        file.originalname,
      );
    const valid =
      purpose === 'TEMPLATE'
        ? this.submissionFileAdmissionService.hasValidSubmissionTemplateSignature(
            file.buffer,
            normalizedFileName,
          )
        : this.submissionFileAdmissionService.isAllowedSubmissionFileType(
            normalizedFileName,
          ) &&
          this.submissionFileAdmissionService.hasValidSubmissionFileSignature(
            file.buffer,
            normalizedFileName,
          );
    if (!valid) {
      throw this.error(MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE);
    }

    if (normalizedFileName.toLowerCase().endsWith('.zip')) {
      const zipRejection =
        await this.submissionFileAdmissionService.inspectSubmissionZipMetadata(
          file.buffer,
        );
      if (zipRejection !== null) {
        throw this.error(
          MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES[zipRejection],
        );
      }
    }
    return this.submissionFileAdmissionService.sanitizeSubmissionFileOriginalName(
      normalizedFileName,
    );
  }

  private requiredOpaqueId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value !== value.trim()
    ) {
      throw this.error(MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD);
    }
    return value;
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
