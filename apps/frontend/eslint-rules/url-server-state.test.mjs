import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import rules from './url-server-state.mjs';

function lint(name, code, file = 'features/example/screen.tsx') {
  return new Linter({ cwd: '/synthetic' }).verify(
    code,
    [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: typescriptParser },
        plugins: { local: { rules } },
        rules: { [`local/${name}`]: 'error' },
      },
    ],
    { filename: `/synthetic/src/${file}` },
  );
}

describe('no-direct-search-params', () => {
  const name = 'no-direct-search-params';
  it.each([
    'useSearchParams();',
    "import { useSearchParams as read } from 'next/navigation'; read();",
    "searchParams.get('page');",
    'new URLSearchParams(location.search);',
    'new URLSearchParams(window.location.search);',
  ])('rejects direct URL readers: %s', (code) => {
    expect(lint(name, code)).toEqual([
      expect.objectContaining({ messageId: 'urlState' }),
    ]);
  });
  it.each([
    'features/example/example-url-state.ts',
    'app/programs/[id]/documents/documents-route.tsx',
    'features/auth/auth-error.ts',
  ])('accepts URL boundary %s', (file) => {
    expect(
      lint(name, "useSearchParams(); searchParams.get('page');", file),
    ).toEqual([]);
  });
  it('rejects unrelated files with an allowlisted basename', () => {
    expect(
      lint(name, 'useSearchParams();', 'features/example/auth-error.ts'),
    ).toEqual([expect.objectContaining({ messageId: 'urlState' })]);
  });
  it('accepts pure query construction and test readers', () => {
    expect(lint(name, 'new URLSearchParams({ page: "2" });')).toEqual([]);
    expect(
      lint(name, 'useSearchParams();', 'features/example/screen.test.tsx'),
    ).toEqual([]);
  });
});

describe('no-window-custom-events', () => {
  const name = 'no-window-custom-events';
  it('rejects a global cache invalidation event', () => {
    expect(
      lint(name, "window.dispatchEvent(new CustomEvent('changed'));"),
    ).toEqual([expect.objectContaining({ messageId: 'queryInvalidation' })]);
  });
  it.each([
    "window.dispatchEvent(new Event('resize'));",
    "element.dispatchEvent(new CustomEvent('changed'));",
    'queryClient.invalidateQueries({ queryKey });',
  ])('accepts non-global events and explicit invalidation: %s', (code) => {
    expect(lint(name, code)).toEqual([]);
  });
  it.each([
    'screen.test.tsx',
    'dialog-shell-test-utils.ts',
    'test-support/events.ts',
  ])('accepts test-owned events in %s', (file) => {
    expect(
      lint(name, "window.dispatchEvent(new CustomEvent('changed'));", file),
    ).toEqual([]);
  });
});

describe('no-effect-server-fetch', () => {
  const name = 'no-effect-server-fetch';
  const imported = "import { listPrograms } from './api';";
  it.each([
    `${imported} useEffect(() => { listPrograms(); }, []);`,
    "import { listPrograms as load } from './catalog-api'; useEffect(() => { load(); }, []);",
    "import { queryOptions } from './queries'; useEffect(() => { queryOptions(); }, []);",
    "import * as api from './api'; useEffect(() => { api.listPrograms(); }, []);",
    `${imported} const load = useCallback(async () => {
      setIsLoading(true);
      try {
        const response = await listPrograms({ page, search, sort });
        setPrograms(response.items);
        setTotal(response.total);
      } catch (error) { setError(error); }
      finally { setIsLoading(false); }
    }, [page, search, sort]);
    useEffect(() => { void load(); }, [load]);`,
    `${imported} const load = useCallback(() => listPrograms(), []); useEffect(load, [load]);`,
    `${imported} function load() { listPrograms(); } useEffect(() => { load(); }, []);`,
    `${imported} const a = () => b(); const b = () => { a(); listPrograms(); }; useEffect(a, []);`,
    "import { useEffect as effect, useCallback as callback } from 'react'; import { load } from './list-queries'; const read = callback(() => load(), []); effect(read, []);",
  ])('rejects direct and locally wrapped API calls: %s', (code) => {
    expect(lint(name, code)).toEqual([
      expect.objectContaining({ messageId: 'serverQuery' }),
    ]);
  });
  it.each([
    `${imported} const onClick = () => listPrograms(); useEffect(() => { focus(); }, []);`,
    'useEffect(() => { setOpen(false); }, []);',
    `${imported} useQuery({ queryKey, queryFn: () => listPrograms() });`,
    `${imported} function screen(listPrograms) { useEffect(() => listPrograms(), []); }`,
    `${imported} const load = () => listPrograms(); function screen(load) { useEffect(() => load(), []); }`,
  ])('accepts subscriptions, UI effects and shadowed bindings: %s', (code) => {
    expect(lint(name, code)).toEqual([]);
  });
  it.each([
    'app/_shell/onboarding-gate.tsx',
    'features/consents/components/use-consent-flow.ts',
    'features/profile/components/profile-onboarding-screen.tsx',
    'features/profile/settings/components/settings-screen.tsx',
    'features/programs/authoring/program-edit-page.tsx',
    'features/programs/documents/milestone-document-editor.tsx',
  ])('accepts the verified form seed boundary %s', (file) => {
    expect(
      lint(
        name,
        `${imported} useEffect(() => { queryClient.fetchQuery({ queryFn: () => listPrograms(), staleTime: 0 }); }, []);`,
        file,
      ),
    ).toEqual([]);
  });
});

describe('no-effect-reset-page', () => {
  const name = 'no-effect-reset-page';
  it.each([
    'useEffect(() => { setPage(1); }, [filter]);',
    'React.useEffect(() => { setPage(page => Math.min(page, total)); }, [total]);',
  ])('rejects effect-driven page changes: %s', (code) => {
    expect(lint(name, code)).toEqual([
      expect.objectContaining({ messageId: 'atomicPage' }),
    ]);
  });
  it('accepts client-side table clamping', () => {
    expect(
      lint(
        name,
        'useEffect(() => { setPage(Math.min(page, totalPages)); }, [page, totalPages]);',
        'components/data-table.tsx',
      ),
    ).toEqual([]);
  });
  it('accepts atomic handler updates', () => {
    expect(
      lint(name, 'const onFilter = () => { setFilter(value); setPage(1); };'),
    ).toEqual([]);
  });
  it('does not exempt other data tables', () => {
    expect(
      lint(
        name,
        'useEffect(() => setPage(1), []);',
        'features/example/data-table.tsx',
      ),
    ).toEqual([expect.objectContaining({ messageId: 'atomicPage' })]);
  });
});
