import { Readable } from 'node:stream';
import {
  SUBMISSION_FILE_STORAGE_ERROR_CODES,
  type StoreSubmissionFileInput,
  type StoredSubmissionFile,
  SubmissionFileStorageError,
  type SubmissionFileStoragePort,
} from '../submissions/submission-file-storage.port';
import { sanitizeSubmissionFileOriginalName } from '../submissions/submission-file-name';
import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  type E2eExternalPortRegistry,
} from './e2e-external-port-registry';

export class E2eFakeSubmissionFileStorage implements SubmissionFileStoragePort {
  private readonly objects = new Map<string, Buffer>();

  constructor(private readonly registry: E2eExternalPortRegistry) {}

  reset(): void {
    this.objects.clear();
  }

  put(input: StoreSubmissionFileInput): Promise<StoredSubmissionFile> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_PUT,
      SUBMISSION_FILE_STORAGE_ERROR_CODES.PUT_FAILED,
    );
    if (failure !== null) return Promise.reject(failure);
    const objectKey =
      input.objectKey ?? `e2e-submission-files/${hash(input.body)}`;
    const body = Buffer.from(input.body);
    this.objects.set(objectKey, body);
    this.registry.recordStorage(objectKey, body);
    return Promise.resolve({
      objectKey,
      originalName: sanitizeSubmissionFileOriginalName(input.originalName),
      contentLength: body.byteLength,
      contentType: input.contentType,
    });
  }

  get(objectKey: string): Promise<Readable> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_GET,
      SUBMISSION_FILE_STORAGE_ERROR_CODES.GET_FAILED,
    );
    if (failure !== null) return Promise.reject(failure);
    const body = this.objects.get(objectKey);
    if (body === undefined) {
      throw new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.GET_FAILED,
      );
    }
    return Promise.resolve(Readable.from(Buffer.from(body)));
  }

  delete(objectKey: string): Promise<void> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_DELETE,
      SUBMISSION_FILE_STORAGE_ERROR_CODES.DELETE_FAILED,
    );
    if (failure !== null) return Promise.reject(failure);
    this.objects.delete(objectKey);
    this.registry.forgetStorage(objectKey);
    return Promise.resolve();
  }

  private configuredFailure(
    operation:
      | typeof E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_PUT
      | typeof E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_GET
      | typeof E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_DELETE,
    code:
      | typeof SUBMISSION_FILE_STORAGE_ERROR_CODES.PUT_FAILED
      | typeof SUBMISSION_FILE_STORAGE_ERROR_CODES.GET_FAILED
      | typeof SUBMISSION_FILE_STORAGE_ERROR_CODES.DELETE_FAILED,
  ): SubmissionFileStorageError | null {
    if (!this.registry.consume(operation)) return null;
    return new SubmissionFileStorageError(code);
  }
}

function hash(body: Buffer): string {
  let value = 0;
  for (const byte of body) {
    value = (value * 31 + byte) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
}
