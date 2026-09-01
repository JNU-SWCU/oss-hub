import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
const require = createRequire(
  existsSync('/app/node_modules')
    ? '/app/package.json'
    : new URL('../../apps/backend/package.json', import.meta.url),
);
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const RESERVED = ['.migration-probe/', '.migration-drill/'];
const ACK = 'I_CONFIRM_WRITERS_STOPPED';
const LOCAL_MINIO = 'http://minio:9000';
const MAX_OBJECT_BYTES = 5 * 1024 * 1024;
const MAX_OBJECT_COUNT = 100_000;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024 * 1024;
const fail = (message) => {
  throw new Error(message);
};
const generic = (operation) => {
  throw new Error(`${operation} failed`);
};

export function validateBucket(bucket) {
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    /\.\.|\.-|-\./.test(bucket) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(bucket)
  ) {
    fail('invalid bucket');
  }
}
export function validateEndpoint(mode, endpoint) {
  if (mode === 'minio') {
    if (endpoint !== LOCAL_MINIO) fail('invalid minio endpoint');
    return;
  }
  if (mode !== 'managed') fail('invalid endpoint mode');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    fail('invalid managed endpoint');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(host)
  )
    fail('invalid managed endpoint');
}
export function configuration(env, side) {
  const prefix = `${side}_S3_`;
  const mode = env[`${prefix}MODE`];
  const endpoint = env[`${prefix}ENDPOINT`];
  const bucket = env[`${prefix}BUCKET`];
  const region = env[`${prefix}REGION`];
  const accessKeyId = env[`${prefix}ACCESS_KEY`];
  const secretAccessKey = env[`${prefix}SECRET_KEY`];
  const pathStyle = env[`${prefix}PATH_STYLE`];
  if (
    ![mode, endpoint, region, bucket, accessKeyId, secretAccessKey].every(
      Boolean,
    ) ||
    pathStyle !== 'true'
  )
    fail(`missing ${side} configuration`);
  validateEndpoint(mode, endpoint);
  validateBucket(bucket);
  if (
    (mode === 'managed' && region !== 'auto') ||
    (mode === 'minio' && region !== 'us-east-1')
  ) {
    fail(`invalid ${side} region`);
  }
  return {
    mode,
    endpoint,
    bucket,
    clientConfig: {
      endpoint,
      forcePathStyle: pathStyle === 'true',
      region,
      credentials: { accessKeyId, secretAccessKey },
    },
  };
}
export function makeClients(
  env,
  makeClient = (config) => new S3Client(config),
) {
  const source = configuration(env, 'SOURCE');
  const target = configuration(env, 'TARGET');
  if (source.endpoint === target.endpoint)
    fail('source and target endpoints must differ');
  return {
    source: { ...source, client: makeClient(source.clientConfig) },
    target: { ...target, client: makeClient(target.clientConfig) },
  };
}
const isApplicationKey = (key) =>
  !RESERVED.some((prefix) => key.startsWith(prefix));
async function bodyBytes(body, expectedBytes) {
  if (body instanceof Uint8Array) {
    if (body.byteLength !== expectedBytes || body.byteLength > MAX_OBJECT_BYTES)
      fail('body size mismatch');
    return Buffer.from(body);
  }
  const chunks = [];
  let consumed = 0;
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk);
    consumed += bytes.byteLength;
    if (consumed > expectedBytes || consumed > MAX_OBJECT_BYTES)
      fail('body size mismatch');
    chunks.push(bytes);
  }
  if (consumed !== expectedBytes) fail('body size mismatch');
  return Buffer.concat(chunks, consumed);
}
async function bodyHash(body, expectedBytes) {
  const hash = createHash('sha256');
  let consumed = 0;
  if (body instanceof Uint8Array) {
    consumed = body.byteLength;
    if (consumed !== expectedBytes || consumed > MAX_OBJECT_BYTES)
      fail('body size mismatch');
    hash.update(body);
  } else {
    for await (const chunk of body) {
      const bytes = Buffer.from(chunk);
      consumed += bytes.byteLength;
      if (consumed > expectedBytes || consumed > MAX_OBJECT_BYTES)
        fail('body size mismatch');
      hash.update(bytes);
    }
  }
  if (consumed !== expectedBytes) fail('body size mismatch');
  return hash.digest('hex');
}
export async function inventory(
  side,
  { prefix = '', includeReserved = false, output } = {},
) {
  const rows = [];
  let token;
  let totalBytes = 0;
  const tokens = new Set();
  try {
    do {
      if (token !== undefined) {
        if (tokens.has(token)) fail('repeated list token');
        tokens.add(token);
      }
      const page = await side.client.send(
        new ListObjectsV2Command({
          Bucket: side.bucket,
          Prefix: prefix || undefined,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        const fullKey = object.Key;
        if (
          typeof fullKey !== 'string' ||
          !Number.isSafeInteger(Number(object.Size)) ||
          Number(object.Size) < 0
        ) {
          fail('invalid inventory object');
        }
        if (
          (!includeReserved && !prefix && !isApplicationKey(fullKey)) ||
          (prefix && !fullKey.startsWith(prefix))
        )
          continue;
        const objectSize = Number(object.Size);
        if (
          objectSize > MAX_OBJECT_BYTES ||
          rows.length >= MAX_OBJECT_COUNT ||
          totalBytes + objectSize > MAX_TOTAL_BYTES
        ) {
          fail('inventory limit exceeded');
        }
        totalBytes += objectSize;
        const key = prefix ? fullKey.slice(prefix.length) : fullKey;
        const got = await side.client.send(
          new GetObjectCommand({ Bucket: side.bucket, Key: fullKey }),
        );
        rows.push([key, objectSize, await bodyHash(got.Body, objectSize)]);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !token) fail('incomplete list result');
    } while (token);
  } catch (error) {
    generic('inventory', error);
  }
  rows.sort((a, b) => Buffer.from(a[0]).compare(Buffer.from(b[0])));
  if (output) await writeManifest(output, rows);
  return rows;
}
export async function writeManifest(path, rows) {
  try {
    const stream = createWriteStream(path, { flags: 'wx', mode: 0o600 });
    stream.end(manifestContents(rows));
    await finished(stream);
  } catch (error) {
    generic('evidence write', error);
  }
}
export function sameManifest(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function manifestContents(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`;
}
async function copy(source, target, targetPrefix = '') {
  let token;
  let count = 0;
  let totalBytes = 0;
  const tokens = new Set();
  try {
    do {
      if (token !== undefined) {
        if (tokens.has(token)) fail('repeated copy token');
        tokens.add(token);
      }
      const page = await source.client.send(
        new ListObjectsV2Command({
          Bucket: source.bucket,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (
          typeof object.Key !== 'string' ||
          !Number.isSafeInteger(Number(object.Size)) ||
          Number(object.Size) < 0
        ) {
          fail('invalid copy object');
        }
        if (!isApplicationKey(object.Key)) continue;
        const objectSize = Number(object.Size);
        if (
          objectSize > MAX_OBJECT_BYTES ||
          count >= MAX_OBJECT_COUNT ||
          totalBytes + objectSize > MAX_TOTAL_BYTES
        ) {
          fail('copy limit exceeded');
        }
        totalBytes += objectSize;
        const got = await source.client.send(
          new GetObjectCommand({ Bucket: source.bucket, Key: object.Key }),
        );
        const body = await bodyBytes(got.Body, objectSize);
        await target.client.send(
          new PutObjectCommand({
            Bucket: target.bucket,
            Key: `${targetPrefix}${object.Key}`,
            Body: body,
            ContentLength: body.length,
          }),
        );
        count++;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !token) fail('incomplete copy list');
    } while (token);
  } catch (error) {
    generic('copy', error);
  }
  return count;
}
function requireAck(env) {
  if (env.WRITERS_STOPPED_ACK !== ACK) fail('writer acknowledgement required');
}
function requireDirection(source, target, sourceMode, targetMode) {
  if (source.mode !== sourceMode || target.mode !== targetMode)
    fail('invalid operation direction');
}
async function requireEmptyPrefix(target, prefix) {
  try {
    const listed = await target.client.send(
      new ListObjectsV2Command({
        Bucket: target.bucket,
        Prefix: prefix,
        MaxKeys: 1,
      }),
    );
    if ((listed.Contents ?? []).length !== 0)
      fail('drill prefix already exists');
  } catch {
    generic('drill prefix check');
  }
}
async function preflight(target) {
  if (target.mode !== 'managed') fail('preflight requires managed target');
  const key = `.migration-probe/${randomBytes(32).toString('hex')}`;
  const bytes = randomBytes(64);
  const expected = createHash('sha256').update(bytes).digest('hex');
  let created = false;
  let primaryFailed = false;
  try {
    await target.client.send(
      new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: bytes }),
    );
    created = true;
    const got = await target.client.send(
      new GetObjectCommand({ Bucket: target.bucket, Key: key }),
    );
    if ((await bodyHash(got.Body, bytes.byteLength)) !== expected)
      fail('preflight hash mismatch');
    const listed = await target.client.send(
      new ListObjectsV2Command({ Bucket: target.bucket, Prefix: key }),
    );
    if (!(listed.Contents ?? []).some((item) => item.Key === key))
      fail('preflight list mismatch');
  } catch {
    primaryFailed = true;
  }
  if (created) {
    try {
      await target.client.send(
        new DeleteObjectCommand({ Bucket: target.bucket, Key: key }),
      );
    } catch {
      generic('preflight cleanup');
    }
  }
  if (primaryFailed) generic('preflight');
  try {
    const absent = await target.client.send(
      new ListObjectsV2Command({ Bucket: target.bucket, Prefix: key }),
    );
    if ((absent.Contents ?? []).some((item) => item.Key === key))
      fail('preflight delete mismatch');
  } catch {
    generic('preflight absence check');
  }
}
export async function run(command, args, env = process.env, makeClient) {
  const { source, target } = makeClients(env, makeClient);
  const output = env.MIGRATION_EVIDENCE_DIR;
  const summary = (rows) => ({
    count: rows.length,
    bytes: rows.reduce((sum, row) => sum + row[1], 0),
    manifest_sha256: createHash('sha256')
      .update(manifestContents(rows))
      .digest('hex'),
  });
  if (command === 'preflight') {
    await preflight(target);
    return { count: 1 };
  }
  if (!output) fail('missing evidence directory');
  if (command === 'inventory') {
    const side =
      args[0] === 'source'
        ? source
        : args[0] === 'target'
          ? target
          : fail('invalid inventory side');
    return summary(
      await inventory(side, { output: `${output}/${args[0]}.manifest` }),
    );
  }
  requireAck(env);
  if (command === 'copy-check') {
    requireDirection(source, target, 'minio', 'managed');
    await copy(source, target);
    const a = await inventory(source, { output: `${output}/source.manifest` });
    const b = await inventory(target, { output: `${output}/target.manifest` });
    if (!sameManifest(a, b)) fail('manifest mismatch');
    return summary(b);
  }
  if (command === 'reverse-copy-check') {
    requireDirection(source, target, 'managed', 'minio');
    await copy(source, target);
    const a = await inventory(source, { output: `${output}/source.manifest` });
    const b = await inventory(target, { output: `${output}/target.manifest` });
    if (!sameManifest(a, b)) fail('manifest mismatch');
    return summary(b);
  }
  if (command === 'rollback-drill') {
    requireDirection(source, target, 'managed', 'minio');
    const id = args[0];
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/.test(id))
      fail('invalid drill id');
    const prefix = `.migration-drill/${id}/`;
    await requireEmptyPrefix(target, prefix);
    await copy(source, target, prefix);
    const a = await inventory(source, { output: `${output}/source.manifest` });
    const b = await inventory(target, {
      prefix,
      output: `${output}/drill.manifest`,
    });
    if (!sameManifest(a, b)) fail('manifest mismatch');
    return summary(b);
  }
  fail('unknown subcommand');
}
if (import.meta.url === `file://${process.argv[1]}`)
  run(process.argv[2], process.argv.slice(3))
    .then((result) =>
      console.log(
        `count=${result.count ?? 0} bytes=${result.bytes ?? 0} manifest_sha256=${result.manifest_sha256 ?? 'n/a'}`,
      ),
    )
    .catch((error) => {
      console.error(`object-storage-migration: ${error.message}`);
      process.exitCode = 1;
    });
