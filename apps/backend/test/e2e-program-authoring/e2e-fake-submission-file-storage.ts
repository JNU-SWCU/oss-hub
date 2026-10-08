import { Readable } from 'node:stream';
import {
  OBJECT_STORAGE_ERROR_CODES,
  type StoreObjectInput,
  type StoredObject,
  ObjectStorageError,
  type ObjectStoragePort,
} from '../../src/storage/domain/object-storage';
import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  type E2eExternalPortRegistry,
} from './e2e-external-port-registry';

export class E2eFakeSubmissionFileStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, Buffer>();

  constructor(private readonly registry: E2eExternalPortRegistry) {}

  reset(): void {
    this.objects.clear();
  }

  put(input: StoreObjectInput): Promise<StoredObject> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_PUT,
      OBJECT_STORAGE_ERROR_CODES.PUT_FAILED,
    );
    if (failure !== null) return Promise.reject(failure);
    const objectKey = input.objectKey;
    const body = Buffer.from(input.body);
    this.objects.set(objectKey, body);
    this.registry.recordStorage(objectKey, body);
    return Promise.resolve({
      objectKey,
      originalName: input.originalName,
      contentLength: body.byteLength,
      contentType: input.contentType,
    });
  }

  get(objectKey: string): Promise<Readable> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_GET,
      OBJECT_STORAGE_ERROR_CODES.GET_FAILED,
    );
    if (failure !== null) return Promise.reject(failure);
    const body = this.objects.get(objectKey);
    if (body === undefined) {
      throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.GET_FAILED);
    }
    return Promise.resolve(Readable.from(Buffer.from(body)));
  }

  delete(objectKey: string): Promise<void> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_DELETE,
      OBJECT_STORAGE_ERROR_CODES.DELETE_FAILED,
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
      | typeof OBJECT_STORAGE_ERROR_CODES.PUT_FAILED
      | typeof OBJECT_STORAGE_ERROR_CODES.GET_FAILED
      | typeof OBJECT_STORAGE_ERROR_CODES.DELETE_FAILED,
  ): ObjectStorageError | null {
    if (!this.registry.consume(operation)) return null;
    return new ObjectStorageError(code);
  }
}
