import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * 플러그인 스크립트를 가짜 Figma API 위에서 끝까지 실행한다. 진짜 Figma 없이도 API 이름
 * 오타·순서 오류·빠진 await를 잡고, 만들어지는 변수·스타일·컴포넌트 수를 고정한다.
 * 시각 확인은 실행한 사람이 Figma에서 한다.
 */
const here = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));
const CODE = readFileSync(here('./code.js'), 'utf8');
const TOKENS = readFileSync(
  here('../../../docs/design-tokens/tokens.json'),
  'utf8',
);

type AnyNode = Record<string, any>;

function createFakeFigma(
  options: { singleMode?: boolean; pageLimit?: number } = {},
) {
  const logs: string[] = [];
  const pages: AnyNode[] = [];
  const collections: AnyNode[] = [];
  const variables: AnyNode[] = [];
  const textStyles: AnyNode[] = [];
  let currentPage: AnyNode;
  let nextId = 1;

  function node(type: string, extra: AnyNode = {}): AnyNode {
    const self: AnyNode = {
      id: String(nextId++),
      type,
      name: type,
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      opacity: 1,
      fills: [],
      strokes: [],
      children: [] as AnyNode[],
      parent: null as AnyNode | null,
      appendChild(child: AnyNode) {
        if (child.parent)
          child.parent.children = child.parent.children.filter(
            (c: AnyNode) => c !== child,
          );
        child.parent = self;
        self.children.push(child);
      },
      insertChild(index: number, child: AnyNode) {
        child.parent = self;
        self.children.splice(index, 0, child);
      },
      remove() {
        if (self.parent)
          self.parent.children = self.parent.children.filter(
            (c: AnyNode) => c !== self,
          );
        self.removed = true;
      },
      resize(w: number, h: number) {
        self.width = w;
        self.height = h;
      },
      rescale(factor: number) {
        self.width *= factor;
        self.height *= factor;
      },
      clone() {
        return node(type, { ...extra, name: self.name });
      },
      findAll(predicate: (n: AnyNode) => boolean): AnyNode[] {
        const found: AnyNode[] = [];
        for (const child of self.children) {
          if (predicate(child)) found.push(child);
          found.push(...(child.findAll?.(predicate) ?? []));
        }
        return found;
      },
      findOne(predicate: (n: AnyNode) => boolean): AnyNode | null {
        for (const child of self.children) {
          if (predicate(child)) return child;
          const inner = child.findOne?.(predicate);
          if (inner) return inner;
        }
        return null;
      },
      setBoundVariable() {},
      async setTextStyleIdAsync() {},
      async loadAsync() {},
      createInstance() {
        const instance = node('INSTANCE', { name: self.name });
        for (const child of self.children) instance.appendChild(child.clone());
        instance.setProperties = () => {};
        return instance;
      },
      ...extra,
    };
    if (type !== 'TEXT' && !('characters' in self)) Object.assign(self, {});
    return self;
  }

  const figma: AnyNode = {
    showUI() {},
    ui: {
      onmessage: null as null | ((message: unknown) => Promise<void>),
      postMessage(message: AnyNode) {
        if (message.type === 'log') logs.push(String(message.text));
      },
    },
    notify() {},
    closePlugin() {},
    root: { children: pages },
    get currentPage() {
      return currentPage;
    },
    createPage() {
      if (options.pageLimit !== undefined && pages.length >= options.pageLimit)
        throw new Error(
          `in createPage: The Starter plan only comes with ${options.pageLimit} pages.`,
        );
      const page = node('PAGE');
      pages.push(page);
      currentPage = page;
      return page;
    },
    async setCurrentPageAsync(page: AnyNode) {
      currentPage = page;
    },
    variables: {
      async getLocalVariableCollectionsAsync() {
        return collections;
      },
      async getLocalVariablesAsync() {
        return variables;
      },
      createVariableCollection(name: string) {
        const collection: AnyNode = {
          id: `collection-${collections.length + 1}`,
          name,
          modes: [{ modeId: 'mode-1', name: 'Mode 1' }],
          renameMode(modeId: string, newName: string) {
            const mode = collection.modes.find(
              (m: AnyNode) => m.modeId === modeId,
            );
            if (mode) mode.name = newName;
          },
          addMode(newName: string) {
            if (options.singleMode)
              throw new Error('in addMode: Limited to 1 modes only');
            const modeId = `mode-${collection.modes.length + 1}`;
            collection.modes.push({ modeId, name: newName });
            return modeId;
          },
        };
        collections.push(collection);
        return collection;
      },
      createVariable(name: string, collection: AnyNode, resolvedType: string) {
        const variable: AnyNode = {
          id: `variable-${variables.length + 1}`,
          name,
          resolvedType,
          variableCollectionId: collection.id,
          valuesByMode: {} as Record<string, unknown>,
          description: '',
          setValueForMode(modeId: string, value: unknown) {
            variable.valuesByMode[modeId] = value;
          },
          remove() {
            const index = variables.indexOf(variable);
            if (index >= 0) variables.splice(index, 1);
          },
        };
        variables.push(variable);
        return variable;
      },
      createVariableAlias(variable: AnyNode) {
        return { type: 'VARIABLE_ALIAS', id: variable.id };
      },
      setBoundVariableForPaint(
        paint: AnyNode,
        field: string,
        variable: AnyNode,
      ) {
        return {
          ...paint,
          boundVariables: {
            [field]: { type: 'VARIABLE_ALIAS', id: variable.id },
          },
        };
      },
    },
    async listAvailableFontsAsync() {
      return ['Regular', 'Semi Bold', 'Bold'].map((style) => ({
        fontName: { family: 'Inter', style },
      }));
    },
    async loadFontAsync() {},
    async getLocalTextStylesAsync() {
      return textStyles;
    },
    createTextStyle() {
      const style: AnyNode = { id: `style-${textStyles.length + 1}`, name: '' };
      textStyles.push(style);
      return style;
    },
    createFrame: () => attach(node('FRAME')),
    createComponent: () => attach(node('COMPONENT')),
    createText: () => attach(node('TEXT', { characters: '' })),
    createEllipse: () => attach(node('ELLIPSE')),
    createRectangle: () => attach(node('RECTANGLE')),
    createNodeFromSvg: () => attach(node('FRAME', { name: 'svg' })),
    createSection: () =>
      attach(node('SECTION', { resizeWithoutConstraints() {} })),
    combineAsVariants(nodes: AnyNode[], parent: AnyNode) {
      const set = node('COMPONENT_SET');
      for (const child of nodes) set.appendChild(child);
      set.defaultVariant = nodes[0];
      parent.appendChild(set);
      return set;
    },
  };
  function attach(created: AnyNode) {
    if (currentPage) currentPage.appendChild(created);
    return created;
  }
  return { figma, logs, pages, collections, variables, textStyles };
}

async function runPlugin(fake: ReturnType<typeof createFakeFigma>) {
  const fetch = async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(TOKENS),
    text: async () =>
      url.endsWith('.svg')
        ? '<svg xmlns="http://www.w3.org/2000/svg"/>'
        : TOKENS,
  });
  const sandbox = vm.createContext({
    figma: fake.figma,
    __html__: '',
    fetch,
    console,
  });
  vm.runInContext(CODE, sandbox, { filename: 'code.js' });
  const onmessage = fake.figma.ui.onmessage;
  if (!onmessage) throw new Error('onmessage가 등록되지 않았다');
  await onmessage({
    type: 'run',
    url: 'https://raw.githubusercontent.com/JNU-SWCU/oss-hub/main/docs/design-tokens/tokens.json',
    steps: { variables: true, components: true },
  });
}

describe('figma plugin code.js', () => {
  it('페이지를 3개까지만 허용하는 요금제면 나머지를 한 페이지의 섹션으로 나눈다', async () => {
    const fake = createFakeFigma({ pageLimit: 3 });
    fake.figma.createPage().name = 'Page 1';
    await runPlugin(fake);

    expect(fake.logs.find((line) => line.startsWith('실패'))).toBeUndefined();
    const library = fake.pages.find((p) => p.name === '라이브러리 (OSS Hub)');
    const sectionNames = library?.children
      .filter((n: AnyNode) => n.type === 'SECTION')
      .map((n: AnyNode) => n.name);
    expect(sectionNames).toEqual(
      expect.arrayContaining(['02 Button', '05 Dialog · Form', '07 Card']),
    );
    expect(fake.pages).toHaveLength(3);
  });

  it('모드를 하나만 허용하는 요금제면 다크 값을 별도 컬렉션에 둔다', async () => {
    const fake = createFakeFigma({ singleMode: true });
    await runPlugin(fake);

    expect(fake.logs.find((line) => line.startsWith('실패'))).toBeUndefined();
    expect(fake.collections.map((c) => c.name)).toEqual([
      'OSS Hub',
      'OSS Hub Dark',
    ]);
    const byName = (name: string, collectionId: string) =>
      fake.variables.find(
        (v) => v.name === name && v.variableCollectionId === collectionId,
      );
    const navy600 = fake.variables.find((v) => v.name === 'palette/navy/600');
    const navy300 = fake.variables.find((v) => v.name === 'palette/navy/300');
    expect(
      byName('semantic/primary', 'collection-1')?.valuesByMode['mode-1'],
    ).toEqual({
      type: 'VARIABLE_ALIAS',
      id: navy600?.id,
    });
    expect(
      byName('semantic/primary', 'collection-2')?.valuesByMode['mode-1'],
    ).toEqual({
      type: 'VARIABLE_ALIAS',
      id: navy300?.id,
    });
  });

  it('가짜 Figma API 위에서 변수·스타일·컴포넌트를 끝까지 만든다', async () => {
    const fake = createFakeFigma();
    await runPlugin(fake);

    const failure = fake.logs.find((line) => line.startsWith('실패'));
    expect(failure, fake.logs.join('\n')).toBeUndefined();
    expect(fake.logs.at(-1)).toContain('완료');

    // 변수: primitive 44 + dimension 22(계단 여섯 단 포함) + light 63 중 값을 못 읽는 cosmos.scrim-rgb 하나 제외
    expect(fake.collections.map((c) => c.name)).toEqual(['OSS Hub']);
    expect(fake.collections[0].modes.map((m: AnyNode) => m.name)).toEqual([
      'Light',
      'Dark',
    ]);
    // + 반투명 변형 7개(semantic/…@10 등)
    expect(fake.variables.length).toBe(44 + 22 + 62 + 7);
    const primary = fake.variables.find((v) => v.name === 'semantic/primary');
    const navy600 = fake.variables.find((v) => v.name === 'palette/navy/600');
    const navy300 = fake.variables.find((v) => v.name === 'palette/navy/300');
    expect(primary?.valuesByMode['mode-1']).toEqual({
      type: 'VARIABLE_ALIAS',
      id: navy600?.id,
    });
    expect(primary?.valuesByMode['mode-2']).toEqual({
      type: 'VARIABLE_ALIAS',
      id: navy300?.id,
    });
    expect(
      fake.variables.find((v) => v.name === 'measure/44')?.valuesByMode[
        'mode-1'
      ],
    ).toBe(44);
    // 배지·표 계단은 코드에서 rem(0.75rem·0.875rem)이다 — Figma 에는 px 로 옮겨 적는다
    const px = (name: string) =>
      fake.variables.find((v) => v.name === name)?.valuesByMode['mode-1'];
    expect(px('fontSize/badge')).toBe(12);
    expect(px('fontSize/table')).toBe(14);

    expect(fake.textStyles.map((s) => s.name)).toEqual([
      'text/page',
      'text/section',
      'text/body',
      'text/small',
      'text/badge',
      'text/table',
    ]);

    const pageNames = fake.pages.map((p) => p.name);
    expect(pageNames).toEqual(
      expect.arrayContaining([
        '00 Cover',
        '01 Tokens',
        '02 Button',
        '03 Badge · 용어 사전',
        '04 Filter Chip',
        '05 Dialog · Form',
        '06 Table',
        '07 Card',
      ]),
    );
    const setNamed = (name: string) =>
      fake.pages
        .flatMap((p) => p.children)
        .find((n) => n.type === 'COMPONENT_SET' && n.name === name);
    expect(setNamed('Button')?.children).toHaveLength(7 * 5 * 3);
    expect(setNamed('StatusBadge')?.children).toHaveLength(10);
    expect(setNamed('FilterChip')?.children).toHaveLength(3);
    const dialogPage = fake.pages.find((p) => p.name === '05 Dialog · Form');
    expect(dialogPage?.children.map((n: AnyNode) => n.name)).toEqual(
      expect.arrayContaining(['Form/Field', 'Dialog/md', 'Dialog/lg']),
    );
  });
});
