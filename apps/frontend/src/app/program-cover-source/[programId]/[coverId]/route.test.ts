import { once } from 'node:events';
import { createServer } from 'node:http';
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
  vi.mocked(backendOrigin).mockReturnValue(`http://127.0.0.1:${address.port}`);
});

beforeEach(() => {
  received = [];
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('ORIGIN_BASIC_AUTH', credential);
});

afterEach(() => vi.unstubAllEnvs());
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
});

it.each([
  ['missing', 404],
  ['text', 502],
  ['redirect', 502],
])(
  'does not relay or cache the %s upstream response',
  async (coverId, status) => {
    const response = await readCover(coverId);

    expect(received.map(({ url }) => url)).toEqual([
      apiPath(`programs/p1/cover/${coverId}`),
    ]);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('location')).toBe(false);
    expect(await response.text()).toBe('');
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
  },
);
