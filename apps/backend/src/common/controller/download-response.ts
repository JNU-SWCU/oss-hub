import type { Response } from 'express';
import type { ErrorCode } from '../error-code';

interface DownloadMetadata {
  readonly contentType: string;
  readonly contentLength: number | null;
  readonly fileName: string;
}

export function setDownloadHeaders(
  response: Pick<Response, 'setHeader'>,
  file: DownloadMetadata,
): void {
  response.setHeader('Content-Type', file.contentType);
  if (file.contentLength !== null) {
    response.setHeader('Content-Length', String(file.contentLength));
  }
  response.setHeader(
    'Content-Disposition',
    attachmentDisposition(file.fileName),
  );
}

export function respondWithDownloadFailure(
  response: Response,
  code: ErrorCode,
  afterHeaders: 'END' | 'DESTROY',
): void {
  if (response.destroyed) return;
  if (response.headersSent) {
    if (afterHeaders === 'DESTROY') response.destroy();
    else response.end();
    return;
  }
  response.removeHeader('Content-Length');
  response.removeHeader('Content-Disposition');
  response.status(code.status).contentType('application/problem+json').json({
    type: 'about:blank',
    title: 'Service Unavailable',
    status: code.status,
    detail: code.message,
    instance: response.req.path,
    code: code.code,
  });
}

function attachmentDisposition(fileName: string): string {
  const fallback = [...fileName]
    .map((character) => {
      const code = character.charCodeAt(0);
      if (
        code < 0x20 ||
        code > 0x7e ||
        character === '"' ||
        character === '\\' ||
        character === '/' ||
        character === ';'
      ) {
        return '_';
      }
      return character;
    })
    .join('')
    .trim();
  const asciiFileName = fallback.length > 0 ? fallback : 'file';
  const encodedFileName = encodeURIComponent(fileName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`;
}
