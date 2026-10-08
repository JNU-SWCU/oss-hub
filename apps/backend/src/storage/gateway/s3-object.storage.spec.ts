import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  OBJECT_STORAGE_ERROR_CODES,
  ObjectStorageError,
  type StoredObject,
} from '../domain/object-storage';
import {
  ObjectStorageConfig,
  type ObjectS3Client,
} from '../object-storage.config';
import { S3ObjectStorage } from './s3-object.storage';

jest.mock('node:crypto', () => ({
  ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
  randomUUID: jest.fn(),
}));

type ObjectS3Send = jest.Mock<
  ReturnType<ObjectS3Client['send']>,
  Parameters<ObjectS3Client['send']>
>;

describe('S3ObjectStorage', () => {
  const settings = {
    bucket: 'managed-submissions',
  };
  const syntheticLeakedCredential = 'synthetic-provider-credential';
  const objectKey = 'submission-files/3b7985fb-59fc-4330-8299-ea8dadb975d1';

  function createSend(): ObjectS3Send {
    return jest.fn<
      ReturnType<ObjectS3Client['send']>,
      Parameters<ObjectS3Client['send']>
    >();
  }

  function createStorage(
    send: ObjectS3Send = createSend().mockResolvedValue({}),
  ) {
    const requireSettings = jest
      .fn<{ bucket: string }, []>()
      .mockReturnValue(settings);
    const config = { requireSettings } as unknown as ObjectStorageConfig;
    const client: ObjectS3Client = { send };
    return {
      storage: new S3ObjectStorage(config, client),
      send,
      requireSettings,
    };
  }

  it('공급된 objectKey와 originalName을 그대로 써서 private 객체와 정확한 콘텐츠 메타데이터를 저장한다', async () => {
    const { storage, send } = createStorage();
    const body = Buffer.from('synthetic-content');

    const stored = await storage.put({
      body,
      contentType: 'application/pdf',
      originalName: '../unsafe/report.pdf',
      objectKey,
    });

    expect(stored).toEqual({
      objectKey,
      originalName: '../unsafe/report.pdf',
      contentLength: body.byteLength,
      contentType: 'application/pdf',
    });

    const command = send.mock.calls[0]?.[0];
    if (!(command instanceof PutObjectCommand)) {
      throw new Error('Expected a PutObjectCommand');
    }
    expect(command.input).toEqual({
      Bucket: settings.bucket,
      Key: objectKey,
      Body: body,
      ContentLength: body.byteLength,
      ContentType: 'application/pdf',
    });
  });

  it('objectKey를 생성하거나 고유화하지 않고 호출마다 공급된 값을 그대로 쓴다', async () => {
    const { storage, send } = createStorage();
    const body = Buffer.from('synthetic-content');
    const suppliedKeys = [
      'program-authoring/alpha',
      'program-authoring/alpha',
      'program-covers/beta',
    ];
    const stored: StoredObject[] = [];

    for (const key of suppliedKeys) {
      stored.push(
        await storage.put({
          body,
          contentType: 'application/zip',
          originalName: 'bundle.zip',
          objectKey: key,
        }),
      );
    }

    expect(stored.map((object) => object.objectKey)).toEqual(suppliedKeys);
    expect(
      send.mock.calls.map((call) =>
        call[0] instanceof PutObjectCommand ? call[0].input.Key : null,
      ),
    ).toEqual(suppliedKeys);
    expect(jest.mocked(randomUUID)).not.toHaveBeenCalled();
  });

  it('설정은 생성 시점이 아니라 첫 요청에서 한 번만 읽어 재사용한다', async () => {
    const { storage, requireSettings } = createStorage();

    expect(requireSettings).not.toHaveBeenCalled();

    await storage.put({
      body: Buffer.from('synthetic-content'),
      contentType: 'application/octet-stream',
      originalName: 'x.bin',
      objectKey,
    });
    await storage.delete(objectKey);

    expect(requireSettings).toHaveBeenCalledTimes(1);
  });

  it('객체를 삭제한다', async () => {
    const { storage, send } = createStorage();

    await storage.delete('submission-files/synthetic-key');

    const command = send.mock.calls[0]?.[0];
    if (!(command instanceof DeleteObjectCommand)) {
      throw new Error('Expected a DeleteObjectCommand');
    }
    expect(command.input).toEqual({
      Bucket: settings.bucket,
      Key: 'submission-files/synthetic-key',
    });
  });

  it('private 객체를 GetObjectCommand로 스트리밍한다', async () => {
    const body = Readable.from(Buffer.from('private-file-body'));
    const { storage, send } = createStorage(
      createSend().mockResolvedValue({ Body: body }),
    );

    await expect(storage.get('submission-files/synthetic-key')).resolves.toBe(
      body,
    );

    const command = send.mock.calls[0]?.[0];
    if (!(command instanceof GetObjectCommand)) {
      throw new Error('Expected a GetObjectCommand');
    }
    expect(command.input).toEqual({
      Bucket: settings.bucket,
      Key: 'submission-files/synthetic-key',
    });
  });

  it.each([{ name: 'NoSuchKey' }, { $metadata: { httpStatusCode: 404 } }])(
    'get에서 provider not-found %j를 구분된 typed error로 치환한다',
    async (providerError) => {
      const { storage } = createStorage(
        createSend().mockRejectedValue(providerError),
      );

      const action = storage.get('submission-files/missing');

      await expect(action).rejects.toEqual(
        new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.GET_NOT_FOUND),
      );
      await expect(action).rejects.toMatchObject({
        name: 'ObjectStorageError',
        message: 'SUBMISSION_FILE_STORAGE_GET_NOT_FOUND',
      });
    },
  );

  it('응답 Body가 스트림이 아니면 GET_FAILED로 실패한다', async () => {
    const { storage } = createStorage(
      createSend().mockResolvedValue({ Body: 'not-a-stream' }),
    );

    await expect(storage.get('submission-files/synthetic-key')).rejects.toEqual(
      new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.GET_FAILED),
    );
  });

  it.each([
    { name: 'NoSuchKey' },
    { name: 'NotFound' },
    { Code: 'NoSuchKey' },
    { $metadata: { httpStatusCode: 404 } },
  ])(
    'provider의 not-found %j를 멱등 성공으로 처리한다',
    async (providerError) => {
      const { storage } = createStorage(
        createSend().mockRejectedValue(providerError),
      );

      await expect(
        storage.delete('submission-files/missing'),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    [
      'put',
      OBJECT_STORAGE_ERROR_CODES.PUT_FAILED,
      'SUBMISSION_FILE_STORAGE_PUT_FAILED',
    ],
    [
      'get',
      OBJECT_STORAGE_ERROR_CODES.GET_FAILED,
      'SUBMISSION_FILE_STORAGE_GET_FAILED',
    ],
    [
      'delete',
      OBJECT_STORAGE_ERROR_CODES.DELETE_FAILED,
      'SUBMISSION_FILE_STORAGE_DELETE_FAILED',
    ],
  ] as const)(
    '%s 실패를 안전한 typed error로 치환한다',
    async (operation, code, legacyCode) => {
      const leaked = 'secret-provider-message';
      const { storage } = createStorage(
        createSend().mockRejectedValue({
          message: leaked,
          headers: { authorization: syntheticLeakedCredential },
          $metadata: { httpStatusCode: 503 },
        }),
      );

      const action =
        operation === 'put'
          ? storage.put({
              body: Buffer.from('x'),
              contentType: 'application/octet-stream',
              originalName: 'x.bin',
              objectKey,
            })
          : operation === 'get'
            ? storage.get(objectKey)
            : storage.delete(objectKey);

      await expect(action).rejects.toEqual(new ObjectStorageError(code));
      await expect(action).rejects.toMatchObject({
        name: 'ObjectStorageError',
        message: legacyCode,
      });
      await expect(action).rejects.not.toThrow(leaked);
      await expect(action).rejects.not.toThrow(syntheticLeakedCredential);
    },
  );
});
