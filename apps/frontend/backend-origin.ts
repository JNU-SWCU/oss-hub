import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function backendOrigin(
  allowlistPath = join(process.cwd(), 'backend-origin.allowlist'),
): string {
  if (process.env.NODE_ENV === 'development') {
    return (process.env.BACKEND_ORIGIN ?? 'http://localhost:4000').replace(
      /\/$/,
      '',
    );
  }
  const raw = process.env.BACKEND_ORIGIN?.trim();
  if (!raw) {
    throw new Error('production build에는 BACKEND_ORIGIN이 필요합니다.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('BACKEND_ORIGIN은 HTTPS origin이어야 합니다.');
  }
  const authority = raw.slice(raw.indexOf('://') + 3).split('/', 1)[0] ?? '';
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    authority.includes('@') ||
    raw.includes('?') ||
    raw.includes('#') ||
    url.pathname !== '/'
  ) {
    throw new Error('BACKEND_ORIGIN은 HTTPS origin이어야 합니다.');
  }
  const approvedDigests = readFileSync(allowlistPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (
    approvedDigests.length === 0 ||
    approvedDigests.some((digest) => !/^[0-9a-f]{64}$/.test(digest))
  ) {
    throw new Error('backend-origin.allowlist가 손상됐습니다.');
  }
  const digest = createHash('sha256').update(url.origin).digest('hex');
  if (!approvedDigests.includes(digest)) {
    throw new Error('BACKEND_ORIGIN이 승인된 rewrite 대상이 아닙니다.');
  }
  return url.origin;
}
