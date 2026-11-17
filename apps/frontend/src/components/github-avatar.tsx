'use client';

import Image, { type ImageLoaderProps } from 'next/image';

function sizedAvatarUrl({ src, width }: ImageLoaderProps): string {
  return `${src}${src.includes('?') ? '&' : '?'}s=${width}`;
}

export function GitHubAvatar({
  src,
  size,
  className,
}: {
  readonly src: string;
  readonly size: number;
  readonly className?: string;
}) {
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      loader={sizedAvatarUrl}
      className={className}
    />
  );
}
