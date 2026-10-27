import { describe, expect, it, vi } from 'vitest';
import ProgramsPage from '../programs/page';
import ArchiveDetailPage from './[repositoryId]/page';
import ProjectDetailPage from '../projects/[projectId]/page';
import { ArchiveDetailView } from '@/features/archive';
import { permanentRedirect, redirect } from 'next/navigation';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((href: string): never => {
    throw new Error(href);
  }),
  permanentRedirect: vi.fn((href: string): never => {
    throw new Error(href);
  }),
}));

describe('archive route migration', () => {
  it('옛 종료 필터는 아카이브로 이동한다', async () => {
    await expect(
      ProgramsPage({
        searchParams: Promise.resolve({ status: 'ended' }),
      }),
    ).rejects.toThrow('/archive');
    expect(redirect).toHaveBeenCalledWith('/archive');
  });

  it('옛 공개 프로젝트 상세는 새 주소로 영구 이동한다', async () => {
    await expect(
      ArchiveDetailPage({
        params: Promise.resolve({ repositoryId: 'project-1' }),
      }),
    ).rejects.toThrow('/projects/project-1');
    expect(permanentRedirect).toHaveBeenCalledWith('/projects/project-1');
  });

  it('새 상세 주소는 기존 공개 프로젝트 상세를 렌더한다', async () => {
    const element = await ProjectDetailPage({
      params: Promise.resolve({ projectId: 'project-1' }),
    });
    expect(element.type).toBe(ArchiveDetailView);
    expect(element.props).toEqual({ repositoryId: 'project-1' });
  });
});
