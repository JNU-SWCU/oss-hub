import { Injectable } from '@nestjs/common';
import { Resolver } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import { BlockList, isIPv4 } from 'node:net';
import { DomainException } from '../common/error-code';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code';
import { parseProgramNoticeUrl } from './program-notice-url';

const MAX_BYTES = 2 * 1024 * 1024;
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');

export type NoticeTransport = {
  readonly resolve: (
    hostname: string,
    signal: AbortSignal,
  ) => Promise<readonly string[]>;
  readonly request: (
    url: URL,
    options: RequestOptions,
    receive: (response: IncomingMessage) => void,
  ) => ClientRequest;
};

const transport: NoticeTransport = {
  resolve: async (hostname, signal) => {
    const resolver = new Resolver({ timeout: 4000, tries: 1 });
    const cancel = () => resolver.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      return await resolver.resolve4(hostname);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  },
  request: (url, options, receive) => request(url, options, receive),
};

@Injectable()
export class ProgramNoticeFetchClient {
  read(source: URL): Promise<string> {
    return fetchProgramNotice(source);
  }
}

// IPv4-only deliberately excludes IPv6 transition/mapped address bypasses.
export function isPublicNoticeAddress(address: string): boolean {
  return isIPv4(address) && !blocked.check(address, 'ipv4');
}

export async function fetchProgramNotice(
  source: URL,
  client: NoticeTransport = transport,
  timeoutMs = 8000,
): Promise<string> {
  const url = parseProgramNoticeUrl(source.href);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  let onAbort: (() => void) | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    onAbort = () =>
      reject(new DomainException(PROGRAM_NOTICE_ERRORS.FETCH_FAILED));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const addresses = await Promise.race([
      client.resolve(url.hostname, signal),
      expired,
    ]);
    signal.throwIfAborted();
    const address = addresses[0];
    if (!address || !addresses.every(isPublicNoticeAddress))
      throw new DomainException(PROGRAM_NOTICE_ERRORS.FETCH_FAILED);
    return await Promise.race([
      readResponse(url, address, client, signal),
      expired,
    ]);
  } catch (error) {
    if (error instanceof Error)
      throw new DomainException(PROGRAM_NOTICE_ERRORS.FETCH_FAILED);
    throw error;
  } finally {
    clearTimeout(deadline);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function readResponse(
  url: URL,
  address: string,
  client: NoticeTransport,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = () =>
      reject(new DomainException(PROGRAM_NOTICE_ERRORS.FETCH_FAILED));
    const outgoing = client.request(
      url,
      {
        method: 'GET',
        agent: false,
        family: 4,
        servername: url.hostname,
        rejectUnauthorized: true,
        signal,
        maxHeaderSize: 16 * 1024,
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
        headers: {
          Accept: 'text/html',
          'Accept-Encoding': 'identity',
          'User-Agent': 'OSS-Hub-Notice-Preview/1.0',
        },
      },
      (response) => {
        response.on('error', fail);
        response.on('aborted', fail);
        const contentType = response.headers['content-type'] ?? '';
        const encoding = response.headers['content-encoding'];
        const length = response.headers['content-length'];
        if (
          response.statusCode !== 200 ||
          !/^text\/html(?:\s*;\s*charset\s*=\s*["']?utf-8["']?)?\s*$/i.test(
            contentType,
          ) ||
          (encoding && encoding !== 'identity') ||
          (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
        ) {
          fail();
          response.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            fail();
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (!response.complete || size > MAX_BYTES) {
            fail();
            return;
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      },
    );
    outgoing.on('error', fail);
    outgoing.end();
  });
}
