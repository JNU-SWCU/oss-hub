import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/profile/components/public-profile-view', () => ({
  PublicProfileView: ({ userId }: { readonly userId: string }) => (
    <div data-user-id={userId} />
  ),
}));

import PublicProfilePage from './page';

describe('PublicProfilePage route boundary', () => {
  it.each(['user_123', '%75ser_123'])(
    '%s를 디코딩해 공개 프로필에 전달한다',
    async (userId) => {
      const params = Promise.resolve({ userId });

      const page = await PublicProfilePage({ params });
      const html = renderToStaticMarkup(page);

      expect(html).toContain('data-user-id="user_123"');
    },
  );
});
