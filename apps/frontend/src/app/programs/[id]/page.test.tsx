import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerApiError } from '@/lib/server-api-client';

const mocks = vi.hoisted(() => ({
  serverApiClient: vi.fn(),
}));

vi.mock('@/lib/server-api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server-api-client')>()),
  serverApiClient: mocks.serverApiClient,
}));

vi.mock('./program-detail-screen', () => ({
  ProgramDetailScreen: ({ programId }: { readonly programId: string }) => (
    <div data-detail-program-id={programId}>프로그램 상세</div>
  ),
}));

import ProgramPage from './page';

function openProgram(id: string) {
  return ProgramPage({ params: Promise.resolve({ id }) });
}

describe('ProgramPage 존재 확인', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.serverApiClient.mockReset();
  });

  it('백엔드가 404로 답한 프로그램은 404 응답으로 끝낸다', async () => {
    mocks.serverApiClient.mockRejectedValue(new ServerApiError(404));

    await expect(openProgram('missing-program')).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
    expect(mocks.serverApiClient).toHaveBeenCalledWith(
      'programs/missing-program',
      expect.anything(),
    );
  });

  it('존재하는 프로그램은 디코드한 programId로 상세 화면을 연다', async () => {
    mocks.serverApiClient.mockResolvedValue({ id: 'program:seed-1' });

    const html = renderToStaticMarkup(await openProgram('program%3Aseed-1'));

    expect(html).toContain('data-detail-program-id="program:seed-1"');
    expect(mocks.serverApiClient).toHaveBeenCalledWith(
      'programs/program%3Aseed-1',
      expect.anything(),
    );
  });

  it.each([
    ['백엔드 5xx', new ServerApiError(503)],
    ['네트워크 실패', new TypeError('fetch failed')],
  ])('%s는 없는 프로그램으로 보지 않고 상세 화면을 연다', async (_, error) => {
    mocks.serverApiClient.mockRejectedValue(error);

    const html = renderToStaticMarkup(await openProgram('program-1'));

    expect(html).toContain('data-detail-program-id="program-1"');
  });
});
