import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/projects', () => ({
  ProjectDetailView: ({ projectId }: { readonly projectId: string }) => (
    <div data-project-id={projectId} />
  ),
}));

import ProjectDetailPage from './page';

describe('ProjectDetailPage route boundary', () => {
  it.each(['repo_123', '%72epo_123'])(
    '%s를 디코딩해 프로젝트 상세에 전달한다',
    async (projectId) => {
      const params = Promise.resolve({ projectId });

      const page = await ProjectDetailPage({ params });
      const html = renderToStaticMarkup(page);

      expect(html).toContain('data-project-id="repo_123"');
    },
  );
});
