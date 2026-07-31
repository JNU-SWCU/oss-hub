import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { SubmissionFileStorageConfig } from './submission-file-storage.config';
import {
  SUBMISSION_FILE_STORAGE_ERROR_CODES,
  SubmissionFileStorageError,
} from './submission-file-storage.port';
import {
  S3SubmissionFileStorage,
  type SubmissionFileS3Client,
} from './s3-submission-file.storage';

describe('S3SubmissionFileStorage', () => {
  const settings = {
    endpoint: 'http://minio.test:9000',
    region: 'synthetic-region',
    bucket: 'private-submissions',
    accessKeyId: 'synthetic-access-key',
    secretAccessKey: 'synthetic-secret-key',
    forcePathStyle: true,
  };

  function createStorage(
    send = jest
      .fn<
        ReturnType<SubmissionFileS3Client['send']>,
        Parameters<SubmissionFileS3Client['send']>
      >()
      .mockResolvedValue({}),
  ) {
    const config = {
      requireSettings: jest.fn().mockReturnValue(settings),
    } as unknown as SubmissionFileStorageConfig;
    const client: SubmissionFileS3Client = { send };
    return {
      storage: new S3SubmissionFileStorage(config, client),
      send,
      config,
    };
  }

  it('랜덤 객체 키로 private 파일과 정확한 콘텐츠 메타데이터를 저장한다', async () => {
    const { storage, send } = createStorage();
    const body = Buffer.from('synthetic-content');

    const first = await storage.put({
      body,
      contentType: 'application/pdf',
      originalName: '../unsafe/report.pdf',
    });
    const second = await storage.put({
      body,
      contentType: 'application/pdf',
      originalName: '../unsafe/report.pdf',
    });

    expect(first.objectKey).toMatch(
      /^submission-files\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.objectKey).not.toBe(first.objectKey);
    expect(first.objectKey).not.toContain('report');
    expect(first.originalName).toBe('report.pdf');
    expect(first).toMatchObject({
      contentLength: body.byteLength,
      contentType: 'application/pdf',
    });

    const command = send.mock.calls[0]?.[0];
    if (!(command instanceof PutObjectCommand)) {
      throw new Error('Expected a PutObjectCommand');
    }
    expect(command.input).toEqual({
      Bucket: settings.bucket,
      Key: first.objectKey,
      Body: body,
      ContentLength: body.byteLength,
      ContentType: 'application/pdf',
    });
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
      jest
        .fn<
          ReturnType<SubmissionFileS3Client['send']>,
          Parameters<SubmissionFileS3Client['send']>
        >()
        .mockResolvedValue({ Body: body }),
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

  it.each([
    { name: 'NoSuchKey' },
    { name: 'NotFound' },
    { Code: 'NoSuchKey' },
    { $metadata: { httpStatusCode: 404 } },
  ])('provider의 not-found를 멱등 성공으로 처리한다', async (providerError) => {
    const { storage } = createStorage(
      jest
        .fn<
          ReturnType<SubmissionFileS3Client['send']>,
          Parameters<SubmissionFileS3Client['send']>
        >()
        .mockRejectedValue(providerError),
    );

    await expect(
      storage.delete('submission-files/missing'),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['put', SUBMISSION_FILE_STORAGE_ERROR_CODES.PUT_FAILED],
    ['get', SUBMISSION_FILE_STORAGE_ERROR_CODES.GET_FAILED],
    ['delete', SUBMISSION_FILE_STORAGE_ERROR_CODES.DELETE_FAILED],
  ] as const)(
    '%s 실패를 안전한 typed error로 치환한다',
    async (operation, code) => {
      const leaked = 'secret-provider-message';
      const send = jest
        .fn<
          ReturnType<SubmissionFileS3Client['send']>,
          Parameters<SubmissionFileS3Client['send']>
        >()
        .mockRejectedValue({
          message: leaked,
          headers: { authorization: settings.secretAccessKey },
          $metadata: { httpStatusCode: 503 },
        });
      const { storage } = createStorage(send);

      const action =
        operation === 'put'
          ? storage.put({
              body: Buffer.from('x'),
              contentType: 'application/octet-stream',
              originalName: 'x.bin',
            })
          : operation === 'get'
            ? storage.get('submission-files/synthetic-key')
            : storage.delete('submission-files/synthetic-key');

      await expect(action).rejects.toEqual(
        new SubmissionFileStorageError(code),
      );
      await expect(action).rejects.not.toThrow(leaked);
      await expect(action).rejects.not.toThrow(settings.secretAccessKey);
    },
  );
});
