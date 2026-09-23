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
      expect.arrayContaining([
        '02 Button',
        '05 Dialog · Form',
        '07 Card',
        '08 실패 · 불러오는 중',
      ]),
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
    // + 반투명 변형 8개(semantic/…@10 등, 실패 설명의 destructive@90 포함)
    expect(fake.variables.length).toBe(44 + 22 + 62 + 8);
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
        '08 실패 · 불러오는 중',
      ]),
    );
    const setNamed = (name: string) =>
      fake.pages
        .flatMap((p) => p.children)
        .find((n) => n.type === 'COMPONENT_SET' && n.name === name);
    // 「누를 수 있는 면」(bare × content)은 따로 두지 않고 같은 격자를 넓혔다.
    expect(setNamed('Button')?.children).toHaveLength(8 * 6 * 3);
    expect(setNamed('StatusBadge')?.children).toHaveLength(10);
    expect(setNamed('FilterChip')?.children).toHaveLength(3);
    const dialogPage = fake.pages.find((p) => p.name === '05 Dialog · Form');
    expect(dialogPage?.children.map((n: AnyNode) => n.name)).toEqual(
      expect.arrayContaining([
        'Form/Field',
        'Form/Textarea',
        'Dialog/md',
        'Dialog/lg',
        'Dialog/alert',
      ]),
    );

    // 실패 표면은 버튼 있는 것·없는 것 둘, 뼈대는 한 칸짜리 컴포넌트 하나다.
    const failureSet = setNamed('FailureState');
    expect(failureSet?.children.map((n: AnyNode) => n.name)).toEqual([
      'retry=true',
      'retry=false',
    ]);
    const statePage = fake.pages.find(
      (p) => p.name === '08 실패 · 불러오는 중',
    );
    const block = statePage?.children.find(
      (n: AnyNode) => n.type === 'COMPONENT' && n.name === 'SkeletonBlock',
    );
    expect(block?.description).toContain('animate-pulse');

    // 부품 목록을 통째로 고정한다 — 하나가 늘거나 이름이 바뀌면 여기서 깨진다.
    const inventory = fake.pages
      .flatMap((p) => p.children)
      .filter(
        (n: AnyNode) => n.type === 'COMPONENT_SET' || n.type === 'COMPONENT',
      )
      .map((n: AnyNode) => n.name)
      .sort();
    expect(inventory).toEqual([
      'Button',
      'Card',
      'Dialog/alert',
      'Dialog/lg',
      'Dialog/md',
      'FailureState',
      'FilterChip',
      'Form/Field',
      'Form/Textarea',
      'SkeletonBlock',
      'StatusBadge',
      'Table/Cell',
      'Table/HeaderCell',
      'Table/RowHeaderCell',
    ]);

    /*
     * 버튼처럼 안 생긴 면: 표면을 칠하지 않고(fills·strokes 없음), 모서리도 44 높이도
     * 내용에 돌려주며, 비활성이어도 흐려지지 않는다(`disabled:opacity-100`).
     */
    const buttonNamed = (name: string) =>
      setNamed('Button')?.children.find((n: AnyNode) => n.name === name);
    const bareContent = buttonNamed(
      'variant=bare, size=content, state=disabled',
    );
    expect(bareContent?.fills).toEqual([]);
    expect(bareContent?.strokes).toEqual([]);
    expect(bareContent?.cornerRadius).toBe(0);
    expect(bareContent?.opacity).toBe(1);
    expect(bareContent?.height).not.toBe(44);
    expect(
      bareContent?.findOne((n: AnyNode) => n.type === 'TEXT')?.fontName,
    ).toEqual({ family: 'Inter', style: 'Regular' });
    // 같은 bare 라도 content 가 아닌 크기는 44 고정을 그대로 지킨다.
    expect(
      buttonNamed('variant=bare, size=default, state=disabled')?.height,
    ).toBe(44);
    // 표면을 칠하는 변형의 비활성은 그대로 반투명이다.
    expect(
      buttonNamed('variant=default, size=default, state=disabled')?.opacity,
    ).toBe(0.5);

    const dialogComponent = (name: string) =>
      dialogPage?.children.find((n: AnyNode) => n.name === name);
    const dialogChild = (component: string, child: string) =>
      dialogComponent(component)?.children.find(
        (n: AnyNode) => n.name === child,
      );

    // 한 줄 입력은 control-height 44 에 좌우 여백이 코드의 `px-4`(16)다.
    const inputBox = dialogChild('Form/Field', 'input');
    expect(inputBox?.height).toBe(44);
    expect([inputBox?.paddingTop, inputBox?.paddingLeft]).toEqual([0, 16]);

    // 여러 줄 입력은 `min-h-20`(80)에 `px-4 py-2`다 — 좌우 여백은 한 줄과 같다.
    const textareaBox = dialogChild('Form/Textarea', 'textarea');
    expect(textareaBox?.height).toBe(80);
    expect([textareaBox?.paddingTop, textareaBox?.paddingLeft]).toEqual([
      8, 16,
    ]);

    // 확인창은 저장 창(576)보다 좁고, 확정 버튼이 「삭제」다. 낭독기 역할·바깥 클릭
    // 규칙은 그림에 안 보이므로 컴포넌트 설명에 적는다.
    const alertDialog = dialogComponent('Dialog/alert');
    expect(alertDialog?.width).toBe(512);
    expect(alertDialog?.description).toContain('alertdialog');
    expect(
      dialogChild('Dialog/alert', 'footer')?.children.map(
        (n: AnyNode) =>
          n.findOne((c: AnyNode) => c.type === 'TEXT')?.characters,
      ),
    ).toEqual(['취소', '삭제']);
    // 저장 창은 1·2칸짜리 폼 그대로다.
    expect(dialogChild('Dialog/md', 'body (위→아래)')?.children).toHaveLength(
      1,
    );
    expect(dialogChild('Dialog/lg', 'body (위→아래)')?.children).toHaveLength(
      2,
    );

    // 색을 변수로 묶었는지 — 어긋난 칸이 다시 생기지 않게 값이 아니라 변수로 본다.
    const variableId = (name: string) =>
      fake.variables.find((v) => v.name === name)?.id;
    const fillId = (n?: AnyNode) => n?.fills?.[0]?.boundVariables?.color?.id;
    const text = (n?: AnyNode) =>
      n?.findOne((c: AnyNode) => c.type === 'TEXT') as AnyNode | undefined;

    // 행 제목 칸은 열 머리글과 같은 클래스다 — 회색 글자(muted-foreground)에 자간 2.5%.
    const rowHeader = fake.pages
      .flatMap((p) => p.children)
      .find((n) => n.name === 'Table/RowHeaderCell');
    expect(fillId(text(rowHeader))).toBe(
      variableId('semantic/muted-foreground'),
    );
    expect(text(rowHeader)?.letterSpacing).toEqual({
      unit: 'PERCENT',
      value: 2.5,
    });

    // 눌린 필터 칩은 secondary 채움이다(button.tsx toggle, #1358).
    const pressedChip = setNamed('FilterChip')?.children.find(
      (n: AnyNode) => n.name === 'state=pressed',
    );
    expect(fillId(pressedChip)).toBe(variableId('semantic/secondary'));
    expect(fillId(text(pressedChip))).toBe(
      variableId('semantic/secondary-foreground'),
    );

    // 실패 설명은 destructive 90% — 반투명 변형 변수로 묶는다.
    const retryVariant = failureSet?.children.find(
      (n: AnyNode) => n.name === 'retry=true',
    );
    const description = retryVariant?.findOne(
      (n: AnyNode) => n.parent?.name === 'description' && n.type === 'TEXT',
    );
    expect(fillId(description)).toBe(variableId('semantic/destructive@90'));
  });
});
