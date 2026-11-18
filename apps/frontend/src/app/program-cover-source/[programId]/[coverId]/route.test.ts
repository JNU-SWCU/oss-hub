import { once } from 'node:events';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { backendOrigin } from '../../../../../backend-origin';
import { apiPath } from '@/lib/api-client';
import { GET } from './route';

vi.mock('../../../../../backend-origin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../backend-origin')>()),
  backendOrigin: vi.fn(),
}));

const credential = `Basic ${Buffer.from(`vercel:${'x'.repeat(32)}`).toString('base64')}`;
const event = 'program.cover_source.failed';
const immutable = 'public, max-age=31536000, immutable';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJxoAAAAASUVORK5CYII=',
  'base64',
);

let received: {
  url: string | undefined;
  authorization?: string;
  cookie?: string;
}[];
let upstreamOrigin: string;
const upstream = createServer((request, response) => {
  const { authorization, cookie } = request.headers;
  received.push({ url: request.url, authorization, cookie });
  if (authorization !== credential) {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic' }).end(credential);
    return;
  }
  const cover = request.url?.split('/').at(-1);
  if (cover === 'redirect') {
    response.writeHead(307, { Location: apiPath('programs/p1/cover/png') });
  } else if (cover === 'png') {
    response
      .writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': immutable,
        'Set-Cookie': 'upstream-test=hidden',
      })
      .end(png);
    return;
  } else {
    response.writeHead(cover === 'missing' ? 404 : 200, {
      'Content-Type': 'text/plain',
      'Cache-Control': immutable,
    });
  }
  response.end(credential);
});

beforeAll(async () => {
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test upstream has no TCP address');
  }
  upstreamOrigin = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  received = [];
  vi.mocked(backendOrigin).mockReturnValue(upstreamOrigin);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('ORIGIN_BASIC_AUTH', credential);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(async () => {
  upstream.close();
  await once(upstream, 'close');
});

const readCover = (coverId: string, search = '') =>
  GET(
    new Request(
      `http://localhost/program-cover-source/p1/${encodeURIComponent(coverId)}${search}`,
      {
        headers: { Authorization: 'Bearer caller', Cookie: 'caller=hidden' },
      },
    ),
    { params: Promise.resolve({ programId: 'p1', coverId }) },
  );

it('streams the authorized public cover and its cache policy without relaying headers', async () => {
  const response = await readCover('png');

  expect(received).toEqual([
    {
      url: apiPath('programs/p1/cover/png'),
      authorization: credential,
      cookie: undefined,
    },
  ]);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('cache-control')).toBe(immutable);
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  expect(console.warn).not.toHaveBeenCalled();
});

it.each([
  ['missing', 404, 404],
  ['text', 502, 200],
  ['redirect', 502, 307],
])(
  'classifies but does not relay or cache the %s upstream response',
  async (coverId, status, upstreamStatus) => {
    const response = await readCover(coverId);

    expect(received.map(({ url }) => url)).toEqual([
      apiPath(`programs/p1/cover/${coverId}`),
    ]);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('location')).toBe(false);
    expect(await response.text()).toBe('');
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      [
        event,
        {
          stage: 'upstream_rejected',
          upstreamStatus,
          imageTypeAllowed: false,
          hasBody: true,
        },
      ],
    ]);
  },
);

it('does not expose an upstream authorization challenge or its body', async () => {
  vi.stubEnv(
    'ORIGIN_BASIC_AUTH',
    `Basic ${Buffer.from(`vercel:${'y'.repeat(32)}`).toString('base64')}`,
  );
  const response = await readCover('png');

  expect(response.status).toBe(502);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.has('www-authenticate')).toBe(false);
  expect(await response.text()).toBe('');
  expect(vi.mocked(console.warn).mock.calls).toEqual([
    [
      event,
      {
        stage: 'upstream_rejected',
        upstreamStatus: 401,
        imageTypeAllowed: false,
        hasBody: true,
      },
    ],
  ]);
});

it('classifies invalid origin authorization without exposing its value or contacting the origin', async () => {
  vi.stubEnv('ORIGIN_BASIC_AUTH', 'redact-this-invalid-credential');
  const response = await readCover('png');

  expect(received).toEqual([]);
  expect(response.status).toBe(502);
  expect([...response.headers]).toEqual([['cache-control', 'no-store']]);
  expect(await response.text()).toBe('');
  expect(vi.mocked(console.warn).mock.calls).toEqual([
    [event, { stage: 'origin_authorization', errorCode: undefined }],
  ]);
});

it.each([
  ['https://backend.example.test', 'origin_hash_read', 'ENOENT'],
  [
    'https://redact-this-origin.example.test/invalid',
    'origin_validation',
    undefined,
  ],
])(
  'distinguishes hash read failures from invalid origin configuration: %s',
  async (origin, stage, errorCode) => {
    const actual = await vi.importActual<
      typeof import('../../../../../backend-origin')
    >('../../../../../backend-origin');
    const directory = await mkdtemp(join(tmpdir(), 'cover-source-'));
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BACKEND_ORIGIN', origin);
    vi.mocked(backendOrigin).mockImplementationOnce(() =>
      actual.backendOrigin(join(directory, 'redact-this-hash-path')),
    );
    try {
      const response = await readCover('png');

      expect(received).toEqual([]);
      expect(response.status).toBe(502);
      expect([...response.headers]).toEqual([['cache-control', 'no-store']]);
      expect(await response.text()).toBe('');
      expect(vi.mocked(console.warn).mock.calls).toEqual([
        [event, { stage, errorCode }],
      ]);
    } finally {
      await rmdir(directory);
    }
  },
);

it.each([
  [new DOMException('redact-this-timeout', 'TimeoutError'), 'TimeoutError'],
  [
    new TypeError('redact-this-fetch-message', {
      cause: Object.assign(new Error('redact-this-cause'), {
        code: 'ECONNRESET',
      }),
    }),
    'ECONNRESET',
  ],
  [
    Object.assign(new Error('redact-this-transport-message'), {
      code: 'redact-this-unknown-code',
    }),
    undefined,
  ],
])(
  'emits only the allowlisted transport classification %#',
  async (error, errorCode) => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(error);
    const response = await readCover('png');

    expect(response.status).toBe(502);
    expect([...response.headers]).toEqual([['cache-control', 'no-store']]);
    expect(await response.text()).toBe('');
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      [event, { stage: 'fetch_transport', errorCode }],
    ]);
  },
);

it('keeps the empty 502 and records the status when cancelling a rejected upstream body fails', async () => {
  const cancel = vi.fn(() => {
    throw new Error('redact-this-cancellation-error');
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(new ReadableStream({ cancel }), { status: 404 }),
  );
  const response = await readCover('png');

  expect(cancel).toHaveBeenCalledOnce();
  expect(response.status).toBe(502);
  expect([...response.headers]).toEqual([['cache-control', 'no-store']]);
  expect(await response.text()).toBe('');
  expect(vi.mocked(console.warn).mock.calls).toEqual([
    [
      event,
      {
        stage: 'upstream_cancel',
        upstreamStatus: 404,
        imageTypeAllowed: false,
        hasBody: true,
      },
    ],
  ]);
});

it.each([
  ['../admin', ''],
  ['png', '?next=/admin'],
])(
  'rejects a non-cover target before contacting the upstream',
  async (coverId, search) => {
    const response = await readCover(coverId, search);

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(received).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  },
);
