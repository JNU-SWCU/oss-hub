import { Injectable } from '@nestjs/common';
import { Resolver } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import { BlockList, isIPv4 } from 'node:net';
import { DomainException } from '../platform/error-code.error';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';
import {
  type DefaultTreeAdapterMap,
  type TreeAdapter,
  defaultTreeAdapter,
  parse,
} from 'parse5';

type Node = DefaultTreeAdapterMap['node'];

type ParentNode = DefaultTreeAdapterMap['parentNode'];

type NoticeElement = DefaultTreeAdapterMap['element'];

const MAX_DEPTH = 100;

const noticeTreeAdapter: TreeAdapter<DefaultTreeAdapterMap> = {
  ...defaultTreeAdapter,
  appendChild(parent, child) {
    assertShallow(parent);
    defaultTreeAdapter.appendChild(parent, child);
  },
  insertBefore(parent, child, reference) {
    assertShallow(parent);
    defaultTreeAdapter.insertBefore(parent, child, reference);
  },
};

function assertShallow(parent: ParentNode): void {
  let depth = 0;
  for (
    let node: ParentNode | null = parent;
    node;
    node = 'parentNode' in node ? node.parentNode : null
  )
    if (++depth > MAX_DEPTH)
      throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
}

const OMIT_TAGS = new Set([
  'script',
  'style',
  'nav',
  'footer',
  'header',
  'aside',
  'form',
  'button',
  'input',
  'iframe',
  'object',
  'embed',
  'svg',
  'canvas',
  'noscript',
  'template',
]);

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'dl',
  'dt',
  'dd',
  'pre',
]);

const BREAK = String.fromCharCode(0xe001);

const BLANK = String.fromCharCode(0xe000);

const IGNORED = new RegExp(
  `[${BREAK}${BLANK}${String.fromCharCode(0x200b, 0xfeff)}]`,
  'g',
);

const SPACING_RUN = new RegExp(`[ \n${BREAK}${BLANK}]+`, 'g');

function attribute(node: NoticeElement, name: string): string {
  return node.attrs.find((attribute) => attribute.name === name)?.value ?? '';
}

function elements(root: Node): NoticeElement[] {
  const found: NoticeElement[] = [];
  const pending = [{ node: root, depth: 0 }];
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    if (entry.depth > MAX_DEPTH || found.length > 50_000)
      throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
    if ('tagName' in entry.node) {
      if (isOmitted(entry.node)) continue;
      found.push(entry.node);
    }
    if ('childNodes' in entry.node) {
      for (const child of [...entry.node.childNodes].reverse())
        pending.push({ node: child, depth: entry.depth + 1 });
    }
  }
  return found;
}

function hasClass(node: NoticeElement, name: string): boolean {
  return attribute(node, 'class').split(/\s+/).includes(name);
}

function isOmitted(node: NoticeElement): boolean {
  return (
    OMIT_TAGS.has(node.tagName) ||
    node.attrs.some((attr) => attr.name === 'hidden') ||
    attribute(node, 'aria-hidden') === 'true' ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
      attribute(node, 'style'),
    )
  );
}

function cleanText(value: string): string {
  return value
    .replace(SPACING_RUN, (run) => {
      if (!run.includes(BREAK) && !run.includes(BLANK)) return run;
      const indent = run.slice(
        Math.max(
          run.lastIndexOf('\n'),
          run.lastIndexOf(BREAK),
          run.lastIndexOf(BLANK),
        ) + 1,
      );
      return (
        (run.includes(BLANK) || run.split('\n').length > 2 ? '\n\n' : '\n') +
        indent
      );
    })
    .split('\n')

    .map((line) =>
      line
        .trimEnd()
        .replace(/^ (?=\S)/, '')
        .replace(/(\S) +/g, '$1 '),
    )
    .join('\n')
    .replace(/\n[ ]*\n(?:[ ]*\n)+/g, '\n\n')
    .trim();
}

function noticeText(root: Node, source: URL, listDepth = 0): string {
  if ('value' in root)
    return root.value.replace(IGNORED, '').replace(/\s+/g, ' ');
  if (!('tagName' in root) || isOmitted(root)) return '';
  if (root.tagName === 'br') return '\n';
  if (root.tagName === 'hr') return BLANK;
  if (root.tagName === 'img') return '';
  if (root.tagName === 'ul' || root.tagName === 'ol')
    return renderList(root, source, listDepth);
  if (root.tagName === 'table')
    return `${BREAK}${renderTable(root, source)}${BREAK}`;
  const content = root.childNodes
    .map((child) => noticeText(child, source, listDepth))
    .join('');
  if (root.tagName === 'a') {
    const href = attribute(root, 'href');
    if (
      content.trim() &&
      href &&
      !href.startsWith('#') &&
      !/[\s\\]/.test(href) &&
      URL.canParse(href, source)
    ) {
      const target = new URL(href, source);
      if (
        ['https:', 'http:'].includes(target.protocol) &&
        !target.username &&
        !target.password &&
        content.trim() !== target.href
      )
        return `${content} (${target.href})`;
    }
  }
  if (!BLOCK_TAGS.has(root.tagName)) return content;
  const text = content.trim();
  if (!text) return BLANK;
  return `${/^h[1-6]$/.test(root.tagName) ? BLANK : ''}${BREAK}${text}${BREAK}`;
}

function renderList(root: NoticeElement, source: URL, depth: number): string {
  let number = /^\d{1,5}$/.test(attribute(root, 'start'))
    ? Number(attribute(root, 'start'))
    : 1;
  const content = root.childNodes
    .map((child) => {
      if (!('tagName' in child) || child.tagName !== 'li')
        return cleanText(noticeText(child, source, depth));
      if (isOmitted(child)) return '';
      const marker = root.tagName === 'ol' ? `${number++}.` : '•';
      const text = cleanText(
        child.childNodes
          .map((node) => noticeText(node, source, depth + 1))
          .join(''),
      );
      return `${'  '.repeat(depth)}${marker} ${text}`;
    })
    .filter(Boolean)
    .join('\n');
  return depth ? `\n${content}\n` : `${BREAK}${content}${BREAK}`;
}

function renderTable(root: NoticeElement, source: URL): string {
  const children = visibleChildren(root);

  const rows = children
    .filter((node) => ['thead', 'tbody', 'tfoot'].includes(node.tagName))
    .flatMap((section) =>
      visibleChildren(section).filter((node) => node.tagName === 'tr'),
    )
    .map((row) =>
      visibleChildren(row).filter((node) =>
        ['th', 'td'].includes(node.tagName),
      ),
    );

  const labelled = !rows.flat().some(
    (cell) =>
      ['rowspan', 'colspan'].some((name) => {
        const span = Number.parseInt(attribute(cell, name), 10);
        return !Number.isNaN(span) && span !== 1;
      }) ||
      elements(cell).some((node) => node !== cell && node.tagName === 'table'),
  );
  const cellText = (cell: NoticeElement) =>
    cleanText(noticeText(cell, source)).replace(/\n+/g, ' / ');
  const first = rows[0];
  const headers =
    labelled &&
    first &&
    rows.length > 1 &&
    first.length > 1 &&
    first.every((cell) => cell.tagName === 'th')
      ? first.map(cellText)
      : null;
  const caption = children.find((node) => node.tagName === 'caption');
  return [
    caption ? cleanText(noticeText(caption, source)) : '',
    ...(headers ? rows.slice(1) : rows).map((row) => {
      const values = row.map(cellText);
      if (headers && headers.length === values.length)
        return values
          .map((value, index) =>
            headers[index] ? `${headers[index]}: ${value}` : value,
          )
          .join(' · ');
      if (
        labelled &&
        row.length === 2 &&
        row[0]?.tagName === 'th' &&
        row[1]?.tagName === 'td'
      )
        return values.join(': ');
      return values.join(' · ');
    }),
  ]
    .filter(Boolean)
    .join('\n');
}

function visibleChildren(node: NoticeElement): NoticeElement[] {
  return node.childNodes.filter(
    (child): child is NoticeElement => 'tagName' in child && !isOmitted(child),
  );
}

const ORIGIN = 'https://sojoong.kr';

const NOTICE_PREFIX = /^https:\/\/sojoong\.kr(?::443)?\/notice\/notice-board\//;

const NOTICE_QUERY =
  /^\?(?:uid=[1-9]\d{0,11}&mod=document|mod=document&uid=[1-9]\d{0,11})$/;

const IMAGE_PREFIX = /^https:\/\/sojoong\.kr(?::443)?\/wp-content\/uploads\//;

export function parseProgramNoticeUrl(input: string): URL {
  const prefix = input.match(NOTICE_PREFIX)?.[0];
  if (
    input.length > 2048 ||
    !prefix ||
    !NOTICE_QUERY.test(input.slice(prefix.length)) ||
    !URL.canParse(input)
  ) {
    throw new DomainException(PROGRAM_NOTICE_ERRORS.INVALID_URL);
  }
  const url = new URL(input);
  return new URL(
    `${ORIGIN}/notice/notice-board/?uid=${url.searchParams.get('uid')}&mod=document`,
  );
}

export function parseProgramNoticeImageUrl(
  input: string,
  sourceUrl?: URL,
): URL | null {
  if (input.length > 2048 || /[\s\\?#]/.test(input)) return null;
  const absolute =
    sourceUrl?.origin === ORIGIN &&
    input.startsWith('/') &&
    !input.startsWith('//')
      ? `${ORIGIN}${input}`
      : input;
  const prefix = absolute.match(IMAGE_PREFIX)?.[0];
  if (!prefix || !URL.canParse(absolute)) return null;
  try {
    const segments = absolute
      .slice(prefix.length)
      .split('/')
      .map(decodeURIComponent);
    if (
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          /[\\/%?#\p{Cc}\p{Cf}]/u.test(segment),
      )
    )
      return null;
    const filename = segments.at(-1);
    if (!filename || !/\.(?:jpe?g|png)$/i.test(filename)) return null;
    const url = new URL(
      `${ORIGIN}/wp-content/uploads/${segments.map(encodeURIComponent).join('/')}`,
    );

    return url.href.length <= 2048 ? url : null;
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

export type ProgramNoticeWarning =
  'NO_IMAGE' | 'MULTIPLE_IMAGES' | 'EXTERNAL_APPLICATION_LINK';

export type ProgramNoticePreview = {
  readonly sourceUrl: string;
  readonly name: string;
  readonly description: string;
  readonly coverImages: string[];
  readonly warnings: ProgramNoticeWarning[];
};

export function extractProgramNotice(
  html: string,
  sourceUrl: URL,
): ProgramNoticePreview {
  if (html.length > 2 * 1024 * 1024)
    throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
  const document = elements(parse(html, { treeAdapter: noticeTreeAdapter }));
  const titleRoot = document.find((node) => hasClass(node, 'kboard-title'));
  const title =
    titleRoot && elements(titleRoot).find((node) => node.tagName === 'h1');
  const contentRoot = document.find((node) => hasClass(node, 'kboard-content'));
  const body =
    contentRoot &&
    elements(contentRoot).find((node) => hasClass(node, 'content-view'));
  if (!title || !body)
    throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
  const name = cleanText(noticeText(title, sourceUrl)).replace(/\s+/g, ' ');
  const description = cleanText(noticeText(body, sourceUrl));
  const coverImages = [
    ...new Set(
      elements(body)
        .filter((node) => node.tagName === 'img')
        .map(
          (node) =>
            (
              parseProgramNoticeImageUrl(attribute(node, 'src'), sourceUrl) ??
              parseProgramNoticeImageUrl(attribute(node, 'data-src'), sourceUrl)
            )?.href,
        )
        .filter((url): url is string => url !== undefined),
    ),
  ].slice(0, 20);
  if (
    !name ||
    name.length > 200 ||
    description.length > 10_000 ||
    (!description && !coverImages.length)
  )
    throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
  const warnings: ProgramNoticeWarning[] = [];
  if (!coverImages.length) warnings.push('NO_IMAGE');
  if (coverImages.length > 1) warnings.push('MULTIPLE_IMAGES');
  if (
    /신청|접수|등록|register|registration|apply|application|education_single/i.test(
      description,
    )
  )
    warnings.push('EXTERNAL_APPLICATION_LINK');
  return {
    sourceUrl: sourceUrl.href,
    name,
    description,
    coverImages,
    warnings,
  };
}

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
