import { describe, expect, it, vi } from 'vitest';
import ArchivePage from './page';
import ArchiveDetailPage from './[repositoryId]/page';
import ProjectDetailPage from '../projects/[projectId]/page';
import { ArchiveDetailView } from '@/features/projects';
import { permanentRedirect } from 'next/navigation';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((href: string): never => {
    throw new Error(href);
  }),
  permanentRedirect: vi.fn((href: string): never => {
    throw new Error(href);
  }),
}));

describe('archive route migration', () => {
  it.each([
    [undefined, '/programs?status=ended'],
    ['2025', '/programs?status=ended&year=2025'],
    ['1999', '/programs?status=ended'],
  ])(
    '옛 목록 연도 %s는 프로그램 종료 탭으로 영구 이동한다',
    async (year, href) => {
      await expect(
        ArchivePage({
          searchParams: Promise.resolve({ year }),
        }),
      ).rejects.toThrow(href);
      expect(permanentRedirect).toHaveBeenCalledWith(href);
    },
  );

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
