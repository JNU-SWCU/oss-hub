import { apiPath } from '@/lib/api-client';

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
