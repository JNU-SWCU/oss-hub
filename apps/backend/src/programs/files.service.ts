import { ValidatedProgramAuthoringUpload, type ProgramExternalCover, ProgramAuthoringUploadToken } from './files.config';
import { Inject, Injectable, Optional, BadRequestException, ConflictException, NotFoundException, StreamableFile } from '@nestjs/common';
import { type ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import { ProgramAuthoringUploadRepository, type ProgramAuthoringUploadDeleteRequestResult, type CreatePendingSubmissionFileInput, SubmissionFilesRepository } from './files.repository';
import { PROGRAM_AUTHORING_UPLOAD_ERROR_CODES, ProgramAuthoringUploadError, type ProgramAuthoringUploadFile, type ProgramAuthoringUploadResponse } from './files.error';
import { SUBMISSION_UPLOAD_MAX_BYTES, PROGRAM_COVER_MAX_BYTES, SUBMISSION_FILE_EXTENSIONS } from './submission-upload.config';
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
import { OBJECT_STORAGE_ERROR_CODES, ObjectStorageError } from '../platform/object-storage.error';
import { SUBMISSION_ZIP_REJECTION_ERROR_CODES, SUBMISSIONS_ERROR_CODES, SubmissionsErrorCode } from './submissions-error-code.error';
import { ProgramScheduleService } from './program-schedule.service';
import { SubmissionZipRejection, MAX_ENTRY_COUNT, MAX_TOTAL_UNCOMPRESSED_BYTES, MAX_ENTRY_UNCOMPRESSED_BYTES } from './submission-zip.error';
import { fromBufferPromise, type Entry } from 'yauzl';

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
export interface UploadedSubmissionFileResponse {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}
export interface DownloadedSubmissionFile {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}
export const MAX_FILE_BYTES = SUBMISSION_UPLOAD_MAX_BYTES;
@Injectable()
export class SubmissionFilesService {
  constructor(
    private readonly repository: SubmissionFilesRepository,
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
