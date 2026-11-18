import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProgramsPage from './page';

const request = vi.hoisted(() => ({ search: '', cookie: '' }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ has: (name: string) => request.cookie === name }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(request.search),
  usePathname: () => '/programs',
  useRouter: () => ({}),
}));

const fetchCatalog = vi.fn<typeof fetch>();

beforeEach(() => {
  request.search = '';
  request.cookie = '';
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'app.example.test');
  vi.stubGlobal('fetch', fetchCatalog.mockReset());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function render(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const client = new QueryClient();
  const page = await ProgramsPage({
    searchParams: Promise.resolve(searchParams),
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>{page}</QueryClientProvider>,
  );
  return {
    html,
    queries: client.getQueryCache().findAll({ queryKey: ['programs'] }),
  };
}

it.each([
  {
    query: '',
    params: {},
    path: 'page=1&pageSize=20&status=current',
    id: 'first-current',
  },
  {
    query:
      'status=ended&year=2025&search=+Alpha+&search=ignored&sort=name&direction=desc&page=2',
    params: {
      status: 'ended',
      year: '2025',
      search: [' Alpha ', 'ignored'],
      sort: 'name',
      direction: 'desc',
      page: '2',
    },
    path: 'page=2&pageSize=20&search=Alpha&status=ended&sort=name&direction=desc&year=2025',
    id: 'filtered-page-two',
  },
])(
  'preloads the catalog cover for $id without serializing viewer fields',
  async ({ query, params, path, id }) => {
    request.search = query;
    fetchCatalog.mockResolvedValueOnce(
      Response.json({
        items: [
          {
            id,
            name: 'Synthetic program',
            organizers: ['Synthetic organizer'],
            trackType: 'CURRICULAR',
            applicationStartAt: '2025-01-01T00:00:00.000Z',
            applicationEndAt: '2025-02-01T00:00:00.000Z',
            endAt: '2025-03-01T00:00:00.000Z',
            coverImageUrl: `/programs/${id}/cover/front`,
            note: { text: 'Private marker' },
            viewerApplicationStatus: 'APPROVED',
            applicationCount: 8,
            pendingApplicationCount: 2,
          },
        ],
        totalPages: 3,
      }),
    );

    const { html, queries } = await render(params);

    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    const [url, options] = fetchCatalog.mock.calls[0] ?? [];
    expect(url).toBe(`https://app.example.test/api/v1/programs?${path}`);
    expect(options?.cache).toBe('no-store');
    expect(options?.headers).toBeUndefined();
    expect(html.match(/<link rel="preload" as="image"[^>]+>/g)).toEqual([
      expect.stringContaining(`%2Fprogram-cover-source%2F${id}%2Ffront`),
    ]);
    expect(html).toContain(`href="/programs/${id}"`);
    expect(
      JSON.stringify(queries.map((query) => query.state.data)),
    ).not.toMatch(
      /Private marker|viewerApplicationStatus|applicationCount|pendingApplicationCount/,
    );
  },
);

it.each(['__Host-oss_session', 'oss_session_dev'])(
  'does not run public SSR when the request carries %s',
  async (cookie) => {
    request.cookie = cookie;

    const { html } = await render({});

    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(html).not.toContain('rel="preload" as="image"');
  },
);

it('leaves the client loading shell available after an unsuccessful prefetch', async () => {
  fetchCatalog.mockResolvedValueOnce(new Response(null, { status: 503 }));

  const { html, queries } = await render({});

  expect(html).toContain('aria-busy="true"');
  expect(queries.every((query) => query.state.data === undefined)).toBe(true);
});
