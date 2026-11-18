import { apiPath } from '@/lib/api-client';

export function optimizedProgramCoverSource(src: string | null): string | null {
  const cover = src?.match(/^(\/[^?#]*)\/programs\/([\w-]+)\/cover\/([\w-]+)$/);
  return cover?.[1] && `${cover[1]}/` === apiPath('/')
    ? `/program-cover-source/${cover[2]}/${cover[3]}`
    : null;
}

export function programCoverSource(
  imageUrl: string | null | undefined,
): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('/programs/')) return apiPath(imageUrl);
  if (!URL.canParse(imageUrl)) return null;
  const url = new URL(imageUrl);
  return url.protocol === 'https:' && !url.username && !url.password
    ? imageUrl
    : null;
}
