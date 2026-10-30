import { createServer, request, type Server } from 'node:http';
import type { RequestOptions } from 'node:https';
import {
  fetchProgramNotice,
  isPublicNoticeAddress,
  type NoticeTransport,
} from './program-notice-fetch.client';

const source = new URL(
  'https://sojoong.kr/notice/notice-board/?uid=123&mod=document',
);
let server: Server;
let origin = '';
let status = 200;
let contentType = 'text/html; charset=UTF-8';
let body = '<html>Synthetic</html>';
let encoding = '';
let stalled = false;
let captured: RequestOptions | undefined;
const resolve = jest.fn(() => Promise.resolve(['8.8.8.8']));
const transport: NoticeTransport = {
  resolve,
  request: (_url, options, receive) => {
    captured = options;
    return request(
      origin,
      {
        method: options.method,
        headers: options.headers,
        signal: options.signal,
        agent: false,
      },
      receive,
    );
  },
};

beforeAll(async () => {
  server = createServer((_request, response) => {
    if (stalled) return;
    response.writeHead(status, {
      'content-type': contentType,
      ...(encoding ? { 'content-encoding': encoding } : {}),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP test server');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  status = 200;
  contentType = 'text/html; charset=UTF-8';
  body = '<html>Synthetic</html>';
  encoding = '';
  stalled = false;
  resolve.mockReset().mockResolvedValue(['8.8.8.8']);
  captured = undefined;
});

it('reads bounded HTML through an HTTP seam while pinning the validated DNS address', async () => {
  expect(await fetchProgramNotice(source, transport)).toBe(body);
  expect(captured).toMatchObject({
    family: 4,
    agent: false,
    servername: 'sojoong.kr',
    rejectUnauthorized: true,
  });
  const lookup = captured?.lookup;
  if (!lookup) throw new Error('Expected pinned lookup');
  const done = jest.fn();
  lookup('sojoong.kr', {}, done);
  expect(done).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  expect(resolve).toHaveBeenCalledTimes(1);
});

it.each([
  '127.0.0.1',
  '10.0.0.1',
  '172.16.0.1',
  '192.168.0.1',
  '169.254.169.254',
  '100.64.0.1',
  '0.0.0.0',
  '192.0.2.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '240.0.0.1',
  '::1',
  '::ffff:8.8.8.8',
  '2001:db8::1',
  'invalid',
])('rejects nonpublic or unsupported DNS address %s', (address) => {
  expect(isPublicNoticeAddress(address)).toBe(false);
});

it('rejects mixed DNS answers before making a request', async () => {
  resolve.mockResolvedValue(['8.8.8.8', '127.0.0.1']);
  await expect(fetchProgramNotice(source, transport)).rejects.toMatchObject({
    errorCode: { code: 'PROGRAM_NOTICE_FETCH_FAILED' },
  });
  expect(captured).toBeUndefined();
});

it.each([301, 302, 307, 308, 404, 500])(
  'rejects status %i without following redirects',
  async (code) => {
    status = code;
    await expect(fetchProgramNotice(source, transport)).rejects.toThrow();
    expect(resolve).toHaveBeenCalledTimes(1);
  },
);

it.each(['application/json', 'image/png', 'text/html; charset=shift_jis'])(
  'rejects unsupported response type %s',
  async (type) => {
    contentType = type;
    await expect(fetchProgramNotice(source, transport)).rejects.toThrow();
  },
);

it('rejects compressed upstream bodies instead of exposing a decompression bomb', async () => {
  encoding = 'gzip';
  await expect(fetchProgramNotice(source, transport)).rejects.toThrow();
});

it('rejects a streamed body larger than the byte bound', async () => {
  body = 'a'.repeat(2 * 1024 * 1024 + 1);
  await expect(fetchProgramNotice(source, transport)).rejects.toThrow();
});

it('times out a stalled upstream connection', async () => {
  stalled = true;
  await expect(fetchProgramNotice(source, transport, 30)).rejects.toThrow();
});

it('bounds DNS resolution by the same overall deadline and never starts a late request', async () => {
  resolve.mockImplementation(() => new Promise(() => {}));
  await expect(fetchProgramNotice(source, transport, 30)).rejects.toThrow();
  expect(captured).toBeUndefined();
});
