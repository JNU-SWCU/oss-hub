import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  OBJECT_STORAGE_ERROR_CODES,
  ObjectStorageError,
  type ObjectInventoryEntry,
} from '../domain/object-storage';
import {
  ObjectStorageConfig,
  type ObjectS3Client,
} from '../object-storage.config';
import { S3ObjectInventory } from './s3-object-inventory';

type ObjectS3Send = jest.Mock<
  ReturnType<ObjectS3Client['send']>,
  Parameters<ObjectS3Client['send']>
>;

describe('S3ObjectInventory', () => {
  const settings = {
    bucket: 'managed-submissions',
  };
  const syntheticLeakedCredential = 'synthetic-provider-credential';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createSend(): ObjectS3Send {
    return jest.fn<
      ReturnType<ObjectS3Client['send']>,
      Parameters<ObjectS3Client['send']>
    >();
  }

  function createInventory(
    send: ObjectS3Send = createSend().mockResolvedValue({}),
  ) {
    const requireSettings = jest
      .fn<{ bucket: string }, []>()
      .mockReturnValue(settings);
    const config = { requireSettings } as unknown as ObjectStorageConfig;
    const client: ObjectS3Client = { send };
    return {
      inventory: new S3ObjectInventory(config, client),
      send,
      requireSettings,
    };
  }

  it('공급된 prefix별로 bounded pagination을 수행해 빠짐없이 나열한다', async () => {
    const firstModified = new Date('2026-08-12T00:00:00.000Z');
    const secondModified = new Date('2026-08-12T01:00:00.000Z');
    const thirdModified = new Date('2026-08-12T02:00:00.000Z');
    const send = createSend()
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'submission-files/one', LastModified: firstModified },
        ],
        IsTruncated: true,
        NextContinuationToken: 'next-page',
      })
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'submission-files/two', LastModified: secondModified },
        ],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'program-authoring/three', LastModified: thirdModified },
        ],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'program-covers/four', LastModified: thirdModified }],
        IsTruncated: false,
      });
    const { inventory, requireSettings } = createInventory(send);
    const expected: ObjectInventoryEntry[] = [
      { key: 'submission-files/one', lastModified: firstModified },
      { key: 'submission-files/two', lastModified: secondModified },
      { key: 'program-authoring/three', lastModified: thirdModified },
      { key: 'program-covers/four', lastModified: thirdModified },
    ];

    await expect(
      inventory.listObjects([
        'submission-files/',
        'program-authoring/',
        'program-covers/',
      ]),
    ).resolves.toEqual(expected);
    expect(send).toHaveBeenCalledTimes(4);
    expect(requireSettings).toHaveBeenCalledTimes(1);
    const [firstCommand, secondCommand, thirdCommand, fourthCommand] =
      send.mock.calls.map((call) => call[0]);
    if (
      !(firstCommand instanceof ListObjectsV2Command) ||
      !(secondCommand instanceof ListObjectsV2Command) ||
      !(thirdCommand instanceof ListObjectsV2Command) ||
      !(fourthCommand instanceof ListObjectsV2Command)
    ) {
      throw new Error('Expected ListObjectsV2Command pagination');
    }
    expect(firstCommand.input).toEqual({
      Bucket: settings.bucket,
      Prefix: 'submission-files/',
      ContinuationToken: undefined,
    });
    expect(secondCommand.input).toEqual({
      Bucket: settings.bucket,
      Prefix: 'submission-files/',
      ContinuationToken: 'next-page',
    });
    expect(thirdCommand.input).toEqual({
      Bucket: settings.bucket,
      Prefix: 'program-authoring/',
      ContinuationToken: undefined,
    });
    expect(fourthCommand.input).toEqual({
      Bucket: settings.bucket,
      Prefix: 'program-covers/',
      ContinuationToken: undefined,
    });
    expect(send.mock.calls[0]?.[1]?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('요청하지 않은 prefix나 버킷 전체는 나열하지 않는다', async () => {
    const send = createSend().mockResolvedValue({
      Contents: [],
      IsTruncated: false,
    });
    const { inventory } = createInventory(send);

    await expect(inventory.listObjects(['program-covers/'])).resolves.toEqual(
      [],
    );

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0];
    if (!(command instanceof ListObjectsV2Command)) {
      throw new Error('Expected a ListObjectsV2Command');
    }
    expect(command.input).toEqual({
      Bucket: settings.bucket,
      Prefix: 'program-covers/',
      ContinuationToken: undefined,
    });
  });

  it('prefix 목록이 비어 있으면 provider를 호출하지 않고 빈 목록을 반환한다', async () => {
    const { inventory, send } = createInventory();

    await expect(inventory.listObjects([])).resolves.toEqual([]);

    expect(send).not.toHaveBeenCalled();
  });

  it('listing 요청마다 30초 abort timeout을 적용한다', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const send = createSend().mockResolvedValue({
      Contents: [],
      IsTruncated: false,
    });
    const { inventory } = createInventory(send);

    await inventory.listObjects(['submission-files/', 'program-covers/']);

    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenNthCalledWith(1, 30_000);
    expect(timeout).toHaveBeenNthCalledWith(2, 30_000);
  });

  it('반복 continuation token을 거부해 listing이 무한 대기하지 않는다', async () => {
    const send = createSend().mockResolvedValue({
      IsTruncated: true,
      NextContinuationToken: 'same-page',
    });
    const { inventory } = createInventory(send);

    await expect(inventory.listObjects(['submission-files/'])).rejects.toEqual(
      new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.LIST_FAILED),
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('truncated 응답에 continuation token이 없으면 LIST_FAILED로 실패한다', async () => {
    const send = createSend().mockResolvedValue({ IsTruncated: true });
    const { inventory } = createInventory(send);

    await expect(inventory.listObjects(['submission-files/'])).rejects.toEqual(
      new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.LIST_FAILED),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { Key: 'submission-files/one' },
    { LastModified: new Date('2026-08-12T00:00:00.000Z') },
  ])(
    '불완전한 객체 metadata %j는 LIST_FAILED로 실패한다',
    async (incompleteObject) => {
      const send = createSend().mockResolvedValue({
        Contents: [incompleteObject],
        IsTruncated: false,
      });
      const { inventory } = createInventory(send);

      await expect(
        inventory.listObjects(['submission-files/']),
      ).rejects.toEqual(
        new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.LIST_FAILED),
      );
    },
  );

  it('list 실패를 안전한 typed error로 치환한다', async () => {
    const leaked = 'secret-provider-message';
    const { inventory } = createInventory(
      createSend().mockRejectedValue({
        message: leaked,
        headers: { authorization: syntheticLeakedCredential },
        $metadata: { httpStatusCode: 503 },
      }),
    );

    const action = inventory.listObjects(['submission-files/']);

    await expect(action).rejects.toEqual(
      new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.LIST_FAILED),
    );
    await expect(action).rejects.toMatchObject({
      name: 'ObjectStorageError',
      message: 'SUBMISSION_FILE_STORAGE_LIST_FAILED',
    });
    await expect(action).rejects.not.toThrow(leaked);
    await expect(action).rejects.not.toThrow(syntheticLeakedCredential);
  });
});
