import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';
import { Readable } from 'node:stream';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import {
  OBJECT_INVENTORY,
  OBJECT_STORAGE,
  type ObjectInventoryPort,
  type ObjectStoragePort,
  type StoreObjectInput,
  type StoredObject,
} from './domain/object-storage';
import { S3ObjectInventory } from './gateway/s3-object-inventory';
import { S3ObjectStorage } from './gateway/s3-object.storage';
import { ObjectStorageConfig, S3_OBJECT_CLIENT } from './object-storage.config';
import { StorageModule } from './storage.module';

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, StorageModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? (metadata as unknown[]) : [];
};

const isProviderObject = (
  provider: unknown,
): provider is Record<string, unknown> =>
  typeof provider === 'object' && provider !== null;

describe('StorageModule', () => {
  const storedObject: StoredObject = {
    objectKey: 'submission-files/synthetic-key',
    originalName: 'report.pdf',
    contentLength: 17,
    contentType: 'application/pdf',
  };

  function createFakeStorage() {
    const put = jest
      .fn<Promise<StoredObject>, [StoreObjectInput]>()
      .mockResolvedValue(storedObject);
    const get = jest
      .fn<Promise<Readable>, [string]>()
      .mockResolvedValue(Readable.from(Buffer.from('private-file-body')));
    const remove = jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined);
    const fake: ObjectStoragePort = { put, get, delete: remove };
    return { fake, put };
  }

  function compileWithFake(fake: ObjectStoragePort): Promise<TestingModule> {
    return Test.createTestingModule({ imports: [StorageModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(fake)
      .compile();
  }

  it('두 포트 토큰을 각각 하나의 useClass 바인딩으로만 제공한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    const bindingsFor = (token: symbol) =>
      providers.filter(
        (provider) => isProviderObject(provider) && provider.provide === token,
      );

    expect(bindingsFor(OBJECT_STORAGE)).toEqual([
      { provide: OBJECT_STORAGE, useClass: S3ObjectStorage },
    ]);
    expect(bindingsFor(OBJECT_INVENTORY)).toEqual([
      { provide: OBJECT_INVENTORY, useClass: S3ObjectInventory },
    ]);
    expect(providers).not.toContain(S3ObjectStorage);
    expect(providers).not.toContain(S3ObjectInventory);
    expect(
      providers.filter(
        (provider) => isProviderObject(provider) && 'useExisting' in provider,
      ),
    ).toEqual([]);
  });

  it('standalone 부팅을 위해 RuntimeConfigModule을 직접 import하고 포트 토큰만 export한다', () => {
    expect(getMetadataArray(MODULE_METADATA.IMPORTS)).toContain(
      RuntimeConfigModule,
    );

    const exported = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(exported).toEqual([OBJECT_STORAGE, OBJECT_INVENTORY]);
    expect(exported).not.toContain(S3ObjectStorage);
    expect(exported).not.toContain(S3ObjectInventory);
  });

  it('override 없이 조립하면 토큰이 실제 S3 구현으로 해석된다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StorageModule],
    }).compile();

    expect(moduleRef.get<ObjectStoragePort>(OBJECT_STORAGE)).toBeInstanceOf(
      S3ObjectStorage,
    );
    expect(moduleRef.get<ObjectInventoryPort>(OBJECT_INVENTORY)).toBeInstanceOf(
      S3ObjectInventory,
    );
    expect(moduleRef.get(ObjectStorageConfig)).toBeInstanceOf(
      ObjectStorageConfig,
    );
    expect(() => {
      moduleRef.get(S3_OBJECT_CLIENT);
    }).toThrow(/S3_OBJECT_CLIENT/);
  });

  it('overrideProvider(OBJECT_STORAGE)로 끼운 대역이 토큰 해석 결과가 된다', async () => {
    const { fake, put } = createFakeStorage();
    const moduleRef = await compileWithFake(fake);

    const resolved = moduleRef.get<ObjectStoragePort>(OBJECT_STORAGE);

    expect(resolved).toBe(fake);
    expect(resolved).not.toBeInstanceOf(S3ObjectStorage);
    await expect(
      resolved.put({
        body: Buffer.from('private-file-body'),
        contentType: 'application/pdf',
        originalName: 'report.pdf',
        objectKey: 'submission-files/synthetic-key',
      }),
    ).resolves.toEqual(storedObject);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('실제 S3 구현은 토큰 바인딩뿐이라 클래스로 따로 해석되지 않는다', async () => {
    const { fake } = createFakeStorage();
    const moduleRef = await compileWithFake(fake);

    expect(() => {
      moduleRef.get(S3ObjectStorage);
    }).toThrow(/S3ObjectStorage/);
    expect(() => {
      moduleRef.get(S3ObjectInventory);
    }).toThrow(/S3ObjectInventory/);
  });
});
