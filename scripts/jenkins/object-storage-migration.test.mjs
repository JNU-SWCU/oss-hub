import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  configuration,
  inventory,
  run,
  validateBucket,
  validateEndpoint,
} from './object-storage-migration.mjs';

const BASE_ENV = Object.freeze({
  SOURCE_S3_MODE: 'managed',
  SOURCE_S3_ENDPOINT:
    'https://00000000000000000000000000000000.r2.cloudflarestorage.com',
  SOURCE_S3_REGION: 'auto',
  SOURCE_S3_ACCESS_KEY: 'source-access-synthetic',
  SOURCE_S3_SECRET_KEY: 'source-secret-synthetic',
  SOURCE_S3_BUCKET: 'source-bucket',
  SOURCE_S3_PATH_STYLE: 'true',
  TARGET_S3_MODE: 'minio',
  TARGET_S3_ENDPOINT: 'http://minio:9000',
  TARGET_S3_REGION: 'us-east-1',
  TARGET_S3_ACCESS_KEY: 'target-access-synthetic',
  TARGET_S3_SECRET_KEY: 'target-secret-synthetic',
  TARGET_S3_BUCKET: 'target-bucket',
  TARGET_S3_PATH_STYLE: 'true',
  WRITERS_STOPPED_ACK: 'I_CONFIRM_WRITERS_STOPPED',
});

async function bytes(body) {
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

class FakeS3Client {
  constructor(objects = [], pages = null) {
    this.objects = new Map(objects);
    this.pages = pages;
    this.calls = [];
    this.failures = new Set();
    this.deletedKeys = [];
  }

  async send(command) {
    const name = command.constructor.name;
    const input = command.input;
    this.calls.push({ name, input });
    if (this.failures.has(name)) throw new Error('synthetic provider failure');

    if (name === 'ListObjectsV2Command') {
      const pageIndex = Number(input.ContinuationToken ?? 0);
      const objects = this.pages?.[pageIndex] ?? [...this.objects.entries()];
      const filtered = objects.filter(
        ([key]) => input.Prefix === undefined || key.startsWith(input.Prefix),
      );
      const hasNext = this.pages !== null && pageIndex + 1 < this.pages.length;
      return {
        Contents: filtered.map(([Key, Body]) => ({ Key, Size: Body.length })),
        IsTruncated: hasNext,
        NextContinuationToken: hasNext ? String(pageIndex + 1) : undefined,
      };
    }

    if (name === 'GetObjectCommand') {
      const body = this.objects.get(input.Key);
      if (body === undefined) throw new Error('synthetic missing object');
      return { Body: Readable.from([body]) };
    }

    if (name === 'PutObjectCommand') {
      this.objects.set(input.Key, await bytes(input.Body));
      return {};
    }

    if (name === 'DeleteObjectCommand') {
      this.deletedKeys.push(input.Key);
      this.objects.delete(input.Key);
      return {};
    }

    throw new Error(`unsupported synthetic command: ${name}`);
  }
}

function clients(source, target) {
  return (config) =>
    config.endpoint.includes(
      '00000000000000000000000000000000.r2.cloudflarestorage.com',
    )
      ? source
      : target;
}

async function evidenceDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'object-migration-test-'));
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test('inventory paginates, excludes evidence prefixes, and hashes bodies', async () => {
  const source = new FakeS3Client(
    [
      ['a', Buffer.from('one')],
      ['b', Buffer.from('two')],
      ['.migration-probe/old', Buffer.from('probe')],
      ['.migration-drill/old/a', Buffer.from('drill')],
    ],
    [
      [['a', Buffer.from('one')]],
      [
        ['b', Buffer.from('two')],
        ['.migration-probe/old', Buffer.from('probe')],
        ['.migration-drill/old/a', Buffer.from('drill')],
      ],
    ],
  );

  const manifest = await inventory({ client: source, bucket: 'source-bucket' });

  assert.deepEqual(
    manifest.map(([key]) => key),
    ['a', 'b'],
  );
  assert.match(manifest[0][2], /^[a-f0-9]{64}$/);
});

test('inventory rejects objects above the application size ceiling', async () => {
  const source = new FakeS3Client([
    ['oversized', Buffer.alloc(5 * 1024 * 1024 + 1)],
  ]);

  await assert.rejects(
    inventory({ client: source, bucket: 'source-bucket' }),
    /inventory failed/,
  );
  assert.equal(
    source.calls.some(({ name }) => name === 'GetObjectCommand'),
    false,
  );
});

test('inventory enforces listed size while consuming the body stream', async () => {
  const source = new FakeS3Client([['inconsistent', Buffer.alloc(1024, 1)]]);
  const originalSend = source.send.bind(source);
  source.send = async (command) => {
    const result = await originalSend(command);
    if (command.constructor.name === 'ListObjectsV2Command') {
      result.Contents[0].Size = 1;
    }
    return result;
  };

  await assert.rejects(
    inventory({ client: source, bucket: 'source-bucket' }),
    /inventory failed/,
  );
});

test('rollback drill copies R2 into an isolated retained MinIO prefix', async (t) => {
  const evidence = await evidenceDirectory();
  t.after(evidence.cleanup);
  const source = new FakeS3Client([
    ['a', Buffer.from('one')],
    ['b', Buffer.from('two')],
  ]);
  const target = new FakeS3Client();

  const result = await run(
    'rollback-drill',
    ['drill-1'],
    { ...BASE_ENV, MIGRATION_EVIDENCE_DIR: evidence.directory },
    clients(source, target),
  );

  assert.equal(result.count, 2);
  assert.equal(target.objects.has('.migration-drill/drill-1/a'), true);
  assert.equal(target.objects.has('.migration-drill/drill-1/b'), true);
  assert.equal(target.deletedKeys.length, 0);
});

test('preflight deletes exactly its generated probe object', async () => {
  const target = new FakeS3Client();

  await run(
    'preflight',
    [],
    {
      ...BASE_ENV,
      SOURCE_S3_MODE: 'minio',
      SOURCE_S3_ENDPOINT: 'http://minio:9000',
      SOURCE_S3_REGION: 'us-east-1',
      TARGET_S3_MODE: 'managed',
      TARGET_S3_ENDPOINT:
        'https://00000000000000000000000000000000.r2.cloudflarestorage.com',
      TARGET_S3_REGION: 'auto',
    },
    () => target,
  );

  assert.equal(target.deletedKeys.length, 1);
  assert.match(target.deletedKeys[0], /^\.migration-probe\/[a-f0-9]{64}$/);
  assert.equal(target.objects.has(target.deletedKeys[0]), false);
});

test('preflight cleans up its exact probe after a post-put failure', async () => {
  const target = new FakeS3Client();
  target.failures.add('GetObjectCommand');

  await assert.rejects(
    run(
      'preflight',
      [],
      {
        ...BASE_ENV,
        SOURCE_S3_MODE: 'minio',
        SOURCE_S3_ENDPOINT: 'http://minio:9000',
        SOURCE_S3_REGION: 'us-east-1',
        TARGET_S3_MODE: 'managed',
        TARGET_S3_ENDPOINT:
          'https://00000000000000000000000000000000.r2.cloudflarestorage.com',
        TARGET_S3_REGION: 'auto',
      },
      () => target,
    ),
    /preflight failed/,
  );

  assert.equal(target.deletedKeys.length, 1);
  assert.match(target.deletedKeys[0], /^\.migration-probe\//);
});

test('rollback drill refuses to reuse retained evidence prefix', async (t) => {
  const evidence = await evidenceDirectory();
  t.after(evidence.cleanup);
  const source = new FakeS3Client([['a', Buffer.from('one')]]);
  const target = new FakeS3Client([
    ['.migration-drill/existing/a', Buffer.from('old')],
  ]);

  await assert.rejects(
    run(
      'rollback-drill',
      ['existing'],
      { ...BASE_ENV, MIGRATION_EVIDENCE_DIR: evidence.directory },
      clients(source, target),
    ),
    /drill prefix check failed/,
  );
  assert.equal(
    target.calls.some(({ name }) => name === 'PutObjectCommand'),
    false,
  );
});

test('copy operations fail closed on writer, direction, provider, and parity errors', async (t) => {
  const evidence = await evidenceDirectory();
  t.after(evidence.cleanup);
  const source = new FakeS3Client([['a', Buffer.from('one')]]);
  const target = new FakeS3Client();

  await assert.rejects(
    run(
      'rollback-drill',
      ['drill'],
      {
        ...BASE_ENV,
        WRITERS_STOPPED_ACK: '',
        MIGRATION_EVIDENCE_DIR: evidence.directory,
      },
      clients(source, target),
    ),
    /writer acknowledgement/,
  );
  await assert.rejects(
    run(
      'copy-check',
      [],
      { ...BASE_ENV, MIGRATION_EVIDENCE_DIR: evidence.directory },
      clients(source, target),
    ),
    /invalid operation direction/,
  );

  const failedTarget = new FakeS3Client();
  failedTarget.failures.add('PutObjectCommand');
  await assert.rejects(
    run(
      'rollback-drill',
      ['put-failure'],
      {
        ...BASE_ENV,
        MIGRATION_EVIDENCE_DIR: join(evidence.directory, 'put-failure'),
      },
      clients(source, failedTarget),
    ),
    /copy failed/,
  );

  const inconsistentSource = new FakeS3Client([['a', Buffer.alloc(1024, 1)]]);
  const originalList = inconsistentSource.send.bind(inconsistentSource);
  inconsistentSource.send = async (command) => {
    const result = await originalList(command);
    if (command.constructor.name === 'ListObjectsV2Command') {
      result.Contents[0].Size = 1;
    }
    return result;
  };
  await assert.rejects(
    run(
      'rollback-drill',
      ['size-mismatch'],
      {
        ...BASE_ENV,
        MIGRATION_EVIDENCE_DIR: join(evidence.directory, 'size-mismatch'),
      },
      clients(inconsistentSource, new FakeS3Client()),
    ),
    /copy failed/,
  );

  const corruptTarget = new FakeS3Client();
  const originalSend = corruptTarget.send.bind(corruptTarget);
  corruptTarget.send = async (command) => {
    if (command.constructor.name === 'PutObjectCommand') {
      command.input.Body = Buffer.from('wrong');
    }
    return originalSend(command);
  };
  const mismatch = join(evidence.directory, 'mismatch');
  await mkdir(mismatch);
  await assert.rejects(
    run(
      'rollback-drill',
      ['mismatch'],
      { ...BASE_ENV, MIGRATION_EVIDENCE_DIR: mismatch },
      clients(source, corruptTarget),
    ),
    /manifest mismatch/,
  );
});

test('manifest evidence is exclusive and provider failures are redacted', async (t) => {
  const evidence = await evidenceDirectory();
  t.after(evidence.cleanup);
  const path = join(evidence.directory, 'source.manifest');
  await writeFile(path, 'existing', { mode: 0o600 });
  const source = new FakeS3Client([['private-key', Buffer.from('body')]]);

  await assert.rejects(
    inventory({ client: source, bucket: 'source-bucket' }, { output: path }),
    /evidence write failed/,
  );

  source.failures.add('GetObjectCommand');
  await assert.rejects(
    inventory({ client: source, bucket: 'source-bucket' }),
    (error) => {
      assert.equal(error.message, 'inventory failed');
      assert.equal(error.message.includes('private-key'), false);
      return true;
    },
  );
});

test('configuration rejects unsafe endpoints, buckets, regions, and booleans', () => {
  assert.throws(() => validateEndpoint('managed', 'https://10.0.0.1'));
  assert.throws(() =>
    validateEndpoint('managed', 'https://storage.example.test'),
  );
  assert.throws(() => validateEndpoint('managed', 'https://example.test/path'));
  assert.throws(() => validateEndpoint('managed', 'https://[fd00::1]'));
  assert.throws(() =>
    validateEndpoint(
      'managed',
      'https://00000000000000000000000000000000.r2.cloudflarestorage.com:8443',
    ),
  );
  assert.throws(() => validateBucket('invalid_bucket'));
  assert.doesNotThrow(() => validateBucket('valid-bucket'));
  assert.throws(() =>
    configuration({ ...BASE_ENV, SOURCE_S3_REGION: 'us-east-1' }, 'SOURCE'),
  );
  assert.throws(() =>
    configuration({ ...BASE_ENV, TARGET_S3_PATH_STYLE: 'TRUE' }, 'TARGET'),
  );
  assert.throws(() =>
    configuration({ ...BASE_ENV, TARGET_S3_PATH_STYLE: 'false' }, 'TARGET'),
  );
});
