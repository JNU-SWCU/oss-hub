/* global figma, __html__, fetch */
/**
 * OSS Hub 디자인 라이브러리 플러그인.
 *
 * 저장소의 `docs/design-tokens/tokens.json`(원본은 globals.css)과 vault 스펙 시트의 수치대로
 * Figma 변수(Light·Dark) · 텍스트 스타일 · 컴포넌트(Button · Badge · FilterChip · Dialog ·
 * Form Field · Table · Card)를 만든다. 사람이 그리는 대신 코드가 그린다 — 코드가 원본이고
 * Figma는 거울이라는 design.md R-36의 연장이다.
 *
 * 실행: Figma 데스크톱 → Plugins → Development → Import plugin from manifest → 이 폴더의
 * manifest.json → Run. 다시 실행하면 같은 이름의 변수·스타일은 재사용하고, 컴포넌트 페이지는
 * 비우고 다시 그린다.
 */

const FONT_FAMILIES = ['Pretendard Variable', 'Pretendard', 'Inter'];
const PAGE_NAMES = {
  cover: '00 Cover',
  tokens: '01 Tokens',
  button: '02 Button',
  badge: '03 Badge · 용어 사전',
  chip: '04 Filter Chip',
  dialog: '05 Dialog · Form',
  table: '06 Table',
  card: '07 Card',
};
const COLLECTION_NAME = 'OSS Hub';
/** Starter 요금제는 컬렉션당 모드가 하나뿐이라 다크 값을 따로 둘 때 쓰는 컬렉션. */
const DARK_COLLECTION_NAME = 'OSS Hub Dark';
const ICON_BASE = 'https://unpkg.com/lucide-static/icons/';

/** @type {{ family: string, regular: string, semibold: string } | null} */
let font = null;
/** @type {Map<string, Variable>} 토큰 경로(점 표기) → Figma 변수 */
const variablesByPath = new Map();
/** @type {Map<string, TextStyle>} */
const textStyles = new Map();
/** 토큰 경로 → 토큰(primitive·dimension·light). alias를 풀어 실제 색을 얻을 때 쓴다. */
let tokenIndex = new Map();
let darkIndex = new Map();
/**
 * 반투명 변형 변수(`semantic/destructive@10` 등). Figma는 변수를 묶은 채우기의 불투명도를
 * 변수의 알파로 정하므로, 코드의 `bg-destructive/10` 같은 변형은 알파를 가진 변수로 따로 둔다.
 */
const tintVariables = new Map();
const TINTS = [
  ['primary', 80],
  ['destructive', 10],
  ['destructive', 20],
  ['foreground', 10],
  ['foreground', 35],
  ['border', 50],
  ['muted', 50],
];
let variableScope = null;

function log(text) {
  figma.ui.postMessage({ type: 'log', text });
}

// ---------- 값 해석 ----------

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const int = parseInt(full, 16);
  return {
    r: ((int >> 16) & 255) / 255,
    g: ((int >> 8) & 255) / 255,
    b: (int & 255) / 255,
  };
}

/**
 * CSS 값 → Figma RGBA. hex, `color-mix(in oklch, var(--palette-white) N%, transparent)`,
 * `rgb(var(--cosmos-scrim-rgb) / N%)`만 안다. 그 밖의 계산값은 null(건너뜀).
 */
function parseCssColor(value) {
  if (/^#[0-9a-f]{3,6}$/i.test(value)) return { ...hexToRgb(value), a: 1 };
  const mix =
    /^color-mix\(in oklch, var\(--palette-(white|black)\) (\d+)%, transparent\)$/.exec(
      value,
    );
  if (mix) {
    const base = mix[1] === 'white' ? 1 : 0;
    return { r: base, g: base, b: base, a: Number(mix[2]) / 100 };
  }
  const scrim = /^rgb\(var\(--cosmos-scrim-rgb\) \/ (\d+)%\)$/.exec(value);
  if (scrim) return { ...hexToRgb('#00133a'), a: Number(scrim[1]) / 100 };
  return null;
}

/** '24px' → 24, '0.625rem' → 10, '200ms' → 200. 못 읽으면 null. */
function parseNumber(value) {
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|ms)?$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return match[2] === 'rem' ? number * 16 : number;
}

function flatten(set, prefix = []) {
  const entries = [];
  for (const [key, node] of Object.entries(set)) {
    if (node && typeof node === 'object' && 'value' in node) {
      entries.push([[...prefix, key].join('.'), node]);
    } else if (node && typeof node === 'object') {
      entries.push(...flatten(node, [...prefix, key]));
    }
  }
  return entries;
}

function figmaName(path) {
  return path.replace(/\./g, '/');
}

/** alias 사슬을 따라가 실제 RGBA를 얻는다. 못 풀면 null. */
function resolveCssColor(path, index) {
  const seen = new Set();
  let token = index.get(path) ?? tokenIndex.get(path);
  while (token) {
    const alias = /^\{(.+)\}$/.exec(token.value);
    if (!alias) return parseCssColor(token.value);
    if (seen.has(alias[1])) return null;
    seen.add(alias[1]);
    token = index.get(alias[1]) ?? tokenIndex.get(alias[1]);
  }
  return null;
}

// ---------- 변수 ----------

/**
 * 컬렉션 「OSS Hub」의 Light 모드와, 다크 값을 둘 자리를 정한다. Professional 이상은 같은
 * 컬렉션의 Dark 모드에, 모드를 하나만 허용하는 Starter 요금제는 별도 컬렉션
 * 「OSS Hub Dark」에 둔다 — 값을 잃는 것보다 자리를 나누는 편이 낫다.
 */
async function ensureCollection() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find((c) => c.name === COLLECTION_NAME);
  if (!collection) {
    collection = figma.variables.createVariableCollection(COLLECTION_NAME);
    collection.renameMode(collection.modes[0].modeId, 'Light');
  }
  const light = (
    collection.modes.find((m) => m.name === 'Light') ?? collection.modes[0]
  ).modeId;
  let dark = collection.modes.find((m) => m.name === 'Dark')?.modeId ?? null;
  let darkCollection = null;
  if (!dark) {
    try {
      dark = collection.addMode('Dark');
    } catch (error) {
      darkCollection =
        collections.find((c) => c.name === DARK_COLLECTION_NAME) ??
        figma.variables.createVariableCollection(DARK_COLLECTION_NAME);
      darkCollection.renameMode(darkCollection.modes[0].modeId, 'Dark');
      log(
        `같은 컬렉션에 Dark 모드를 못 만든다(${error instanceof Error ? error.message : String(error)}). 다크 값은 「${DARK_COLLECTION_NAME}」 컬렉션에 둔다.`,
      );
    }
  }
  return { collection, light, dark, darkCollection };
}

async function ensureVariable(existing, name, collection, type) {
  const found = existing.find(
    (v) => v.name === name && v.variableCollectionId === collection.id,
  );
  return found ?? figma.variables.createVariable(name, collection, type);
}

function setTokenValue(variable, modeId, token) {
  const alias = /^\{(.+)\}$/.exec(token.value);
  if (alias) {
    const target = variablesByPath.get(alias[1]);
    if (target) {
      variable.setValueForMode(
        modeId,
        figma.variables.createVariableAlias(target),
      );
      return true;
    }
    return false;
  }
  if (variable.resolvedType === 'COLOR') {
    const color = parseCssColor(token.value);
    if (!color) return false;
    variable.setValueForMode(modeId, color);
    return true;
  }
  const number = parseNumber(token.value);
  if (number === null) return false;
  variable.setValueForMode(modeId, number);
  return true;
}

function variableType(token) {
  return token.type === 'color' ? 'COLOR' : 'FLOAT';
}

async function createVariables(tokens) {
  const { collection, light, dark, darkCollection } = await ensureCollection();
  const existing = await figma.variables.getLocalVariablesAsync();
  let created = 0;
  let darkCreated = 0;
  const skipped = [];
  const darkTokens = new Map(flatten(tokens.dark));

  for (const [set, prefix] of [
    ['primitive', ''],
    ['dimension', ''],
    ['light', 'semantic.'],
  ]) {
    for (const [path, token] of flatten(tokens[set])) {
      const name = figmaName(prefix + path);
      const variable = await ensureVariable(
        existing,
        name,
        collection,
        variableType(token),
      );
      if (!setTokenValue(variable, light, token)) {
        skipped.push(name);
        variable.remove();
        continue;
      }
      const darkToken = set === 'light' ? darkTokens.get(path) : undefined;
      if (dark) {
        setTokenValue(variable, dark, darkToken ?? token);
      } else if (darkCollection && darkToken) {
        const darkVariable = await ensureVariable(
          existing,
          name,
          darkCollection,
          variableType(darkToken),
        );
        const darkMode = darkCollection.modes[0].modeId;
        if (setTokenValue(darkVariable, darkMode, darkToken)) darkCreated += 1;
        else darkVariable.remove();
      }
      if (token.description) variable.description = token.description;
      variablesByPath.set(path, variable);
      created += 1;
    }
  }
  log(
    dark
      ? `변수 ${created}개 (컬렉션 「${COLLECTION_NAME}」, Light·Dark 모드)`
      : `변수 ${created}개 (「${COLLECTION_NAME}」 Light) + 다크 ${darkCreated}개 (「${DARK_COLLECTION_NAME}」)`,
  );
  if (skipped.length) log(`값을 못 읽어 건너뜀: ${skipped.join(', ')}`);
  variableScope = { collection, light, dark, darkCollection };
  await createTints(existing);
}

async function createTints(existing) {
  const { collection, light, dark, darkCollection } = variableScope;
  for (const [path, pct] of TINTS) {
    const lightColor = resolveCssColor(path, tokenIndex);
    if (!lightColor) continue;
    const name = `semantic/${figmaName(path)}@${pct}`;
    const variable = await ensureVariable(existing, name, collection, 'COLOR');
    variable.setValueForMode(light, { ...lightColor, a: pct / 100 });
    variable.description = `${path} ${pct}% — 코드의 /${pct} 변형(bg-${path}/${pct})`;
    const darkColor = resolveCssColor(path, darkIndex) ?? lightColor;
    if (dark) {
      variable.setValueForMode(dark, { ...darkColor, a: pct / 100 });
    } else if (darkCollection) {
      const darkVariable = await ensureVariable(
        existing,
        name,
        darkCollection,
        'COLOR',
      );
      darkVariable.setValueForMode(darkCollection.modes[0].modeId, {
        ...darkColor,
        a: pct / 100,
      });
    }
    tintVariables.set(`${path}@${pct}`, variable);
  }
  log(`반투명 변수 ${tintVariables.size}개 (semantic/…@10 등)`);
}

// ---------- 폰트 · 텍스트 스타일 ----------

async function resolveFont() {
  const available = await figma.listAvailableFontsAsync();
  for (const family of FONT_FAMILIES) {
    const styles = available
      .filter((f) => f.fontName.family === family)
      .map((f) => f.fontName.style);
    if (styles.length === 0) continue;
    const regular = styles.find((s) => /^regular$/i.test(s)) ?? styles[0];
    const semibold =
      styles.find((s) => /^semi ?bold$/i.test(s)) ??
      styles.find((s) => /bold/i.test(s)) ??
      regular;
    await figma.loadFontAsync({ family, style: regular });
    await figma.loadFontAsync({ family, style: semibold });
    font = { family, regular, semibold };
    log(`폰트: ${family} (${regular} · ${semibold})`);
    return;
  }
  throw new Error(
    'Pretendard도 Inter도 없다. 폰트를 설치하고 Figma를 다시 연다.',
  );
}

/*
 * 줄 간격·자간은 코드가 원본이다. 제목 두 단계는 PageHeader·SectionHeading 이
 * 쓰는 `leading-tight`(1.25)·`tracking-tight`(-2.5%) 와 같은 값을 적는다.
 * 앞서 120%·-1% 로 적혀 있던 것은 스펙 시트의 제안값이었고 화면에 반영된 적이
 * 없다 — 실측해 보니 코드와 어긋나 있었다(#1344).
 */
const TEXT_STYLES = [
  {
    name: 'text/page',
    size: 40,
    weight: 'semibold',
    lineHeight: 125,
    letter: -2.5,
  },
  {
    name: 'text/section',
    size: 24,
    weight: 'semibold',
    lineHeight: 125,
    letter: -2.5,
  },
  {
    name: 'text/body',
    size: 16,
    weight: 'regular',
    lineHeight: 150,
    letter: 0,
  },
  {
    name: 'text/small',
    size: 13,
    weight: 'regular',
    lineHeight: 150,
    letter: 0,
  },
  {
    name: 'text/badge',
    size: 12,
    weight: 'semibold',
    lineHeight: 133,
    letter: 0,
  },
  {
    name: 'text/table',
    size: 14,
    weight: 'regular',
    lineHeight: 145,
    letter: 0,
  },
];

async function createTextStyles() {
  const existing = await figma.getLocalTextStylesAsync();
  for (const spec of TEXT_STYLES) {
    let style = existing.find((s) => s.name === spec.name);
    if (!style) {
      style = figma.createTextStyle();
      style.name = spec.name;
    }
    style.fontName = { family: font.family, style: font[spec.weight] };
    style.fontSize = spec.size;
    style.lineHeight = { unit: 'PERCENT', value: spec.lineHeight };
    style.letterSpacing = { unit: 'PERCENT', value: spec.letter };
    textStyles.set(spec.name, style);
  }
  log(`텍스트 스타일 ${TEXT_STYLES.length}개`);
}

// ---------- 그리기 도구 ----------

function paintFor(path, opacity = 1) {
  const pct = Math.round(opacity * 100);
  const variable =
    pct < 100 ? tintVariables.get(`${path}@${pct}`) : variablesByPath.get(path);
  if (!variable) {
    // 변수가 없으면 값이라도 맞춘다 — 색은 토큰에서 풀고 불투명도는 그대로 준다.
    const color = resolveCssColor(path, tokenIndex);
    return {
      type: 'SOLID',
      color: color
        ? { r: color.r, g: color.g, b: color.b }
        : { r: 0, g: 0, b: 0 },
      opacity,
    };
  }
  return figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0, g: 0, b: 0 } },
    'color',
    variable,
  );
}

function bindNumber(node, field, path) {
  const variable = variablesByPath.get(path);
  if (!variable) return;
  try {
    node.setBoundVariable(field, variable);
  } catch {
    // 이 필드를 변수로 묶을 수 없는 노드면 값만 남긴다.
  }
}

async function makeText(characters, options) {
  const node = figma.createText();
  const weight = options.weight ?? 'regular';
  node.fontName = { family: font.family, style: font[weight] };
  node.characters = characters;
  node.fontSize = options.size ?? 16;
  node.lineHeight = { unit: 'PERCENT', value: options.lineHeight ?? 150 };
  if (options.letter)
    node.letterSpacing = { unit: 'PERCENT', value: options.letter };
  node.fills = [paintFor(options.color ?? 'foreground')];
  node.textAutoResize = 'WIDTH_AND_HEIGHT';
  if (options.align) node.textAlignHorizontal = options.align;
  if (options.style && textStyles.has(options.style)) {
    await node.setTextStyleIdAsync(textStyles.get(options.style).id);
  }
  return node;
}

function autoLayout(node, options) {
  node.layoutMode = options.direction ?? 'HORIZONTAL';
  node.primaryAxisAlignItems = options.mainAlign ?? 'MIN';
  node.counterAxisAlignItems = options.crossAlign ?? 'CENTER';
  node.itemSpacing = options.gap ?? 0;
  const [top, right, bottom, left] = options.padding ?? [0, 0, 0, 0];
  node.paddingTop = top;
  node.paddingRight = right;
  node.paddingBottom = bottom;
  node.paddingLeft = left;
  node.primaryAxisSizingMode = options.mainSizing ?? 'AUTO';
  node.counterAxisSizingMode = options.crossSizing ?? 'AUTO';
  if (options.radius !== undefined) node.cornerRadius = options.radius;
  node.fills = options.fill ? [options.fill] : [];
  if (options.stroke) {
    node.strokes = [options.stroke];
    node.strokeWeight = 1;
    node.strokeAlign = 'INSIDE';
  }
  return node;
}

function frame(name, options) {
  const node = figma.createFrame();
  node.name = name;
  return autoLayout(node, options);
}

function component(name, options) {
  const node = figma.createComponent();
  node.name = name;
  return autoLayout(node, options);
}

async function icon(name, size = 16, color = 'foreground') {
  let node;
  try {
    const response = await fetch(`${ICON_BASE}${name}.svg`);
    // 프레임을 나중에 줄이면(rescale) 오른쪽이 잘리는 경우가 있어, SVG의 크기 속성을
    // 목표 크기로 바꿔 그 크기로 바로 들여온다. viewBox가 선을 비율대로 맞춘다.
    const svg = (await response.text())
      .replace(/\swidth="24"/, ` width="${size}"`)
      .replace(/\sheight="24"/, ` height="${size}"`);
    node = figma.createNodeFromSvg(svg);
    // lucide는 stroke="currentColor"라 검정으로 들어온다 — 글자색 변수로 바꿔 묶는다.
    for (const child of node.findAll((n) => 'strokes' in n)) {
      if (child.strokes.length > 0) child.strokes = [paintFor(color)];
    }
  } catch {
    node = figma.createFrame();
    node.fills = [];
    node.strokes = [paintFor(color)];
    node.resize(size, size);
  }
  node.name = `icon/${name}`;
  // 선 굵기가 프레임 밖으로 조금 나가도 잘리지 않게 한다.
  if ('clipsContent' in node) node.clipsContent = false;
  return node;
}

/** 아이콘만 있는 44×44 ghost 버튼(툴팁·aria-label은 코드가 맡는다). 카드·표 예시용. */
async function iconButton(name) {
  const node = frame(`icon button/${name}`, {
    mainAlign: 'CENTER',
    mainSizing: 'FIXED',
    crossSizing: 'FIXED',
    radius: 8,
  });
  node.resize(44, 44);
  node.appendChild(await icon(name, 16));
  return node;
}

/** 페이지 대신 섹션으로 나눌 때(Starter는 파일당 페이지 3개) 쓰는 상태. */
let pagesAllowed = true;
let libraryPage = null;
const sections = [];

/**
 * 이름의 페이지를 비워서 돌려준다. 페이지를 더 못 만드는 요금제면 우리 것이 아닌 첫
 * 페이지를 「OSS Hub 라이브러리」로 삼고 그 안에 같은 이름의 섹션을 만든다 — 페이지든
 * 섹션이든 호출부는 똑같이 `appendChild`로 쓴다.
 */
async function preparePage(name) {
  const pages = figma.root.children;
  let page = pages.find((p) => p.name === name);
  if (!page && pagesAllowed) {
    try {
      page = figma.createPage();
      page.name = name;
    } catch (error) {
      pagesAllowed = false;
      log(
        `페이지를 더 못 만든다(${error instanceof Error ? error.message : String(error)}). 남은 것은 한 페이지 안의 섹션으로 나눈다.`,
      );
    }
  }
  if (page) {
    await page.loadAsync();
    for (const child of [...page.children]) child.remove();
    await figma.setCurrentPageAsync(page);
    return page;
  }
  if (!libraryPage) {
    const ours = new Set(Object.values(PAGE_NAMES));
    libraryPage =
      pages.find((p) => p.name === '라이브러리 (OSS Hub)') ??
      pages.find((p) => !ours.has(p.name)) ??
      figma.currentPage;
    await libraryPage.loadAsync();
    libraryPage.name = '라이브러리 (OSS Hub)';
  }
  await figma.setCurrentPageAsync(libraryPage);
  for (const child of [...libraryPage.children]) {
    if (child.type === 'SECTION' && child.name === name) child.remove();
  }
  const section = figma.createSection();
  section.name = name;
  libraryPage.appendChild(section);
  sections.push(section);
  return section;
}

/** 섹션을 안의 내용에 맞게 키우고 세로로 차례차례 놓는다. 페이지를 썼으면 할 일이 없다. */
function layoutSections() {
  let y = 0;
  for (const section of sections) {
    let maxX = 0;
    let maxY = 0;
    for (const child of section.children) {
      maxX = Math.max(maxX, child.x + child.width);
      maxY = Math.max(maxY, child.y + child.height);
    }
    section.resizeWithoutConstraints(maxX + 96, maxY + 96);
    section.x = 0;
    section.y = y;
    y += section.height + 160;
  }
}

function grid(nodes, columns, gapX, gapY) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  nodes.forEach((node, index) => {
    if (index > 0 && index % columns === 0) {
      x = 0;
      y += rowHeight + gapY;
      rowHeight = 0;
    }
    node.x = x;
    node.y = y;
    x += node.width + gapX;
    rowHeight = Math.max(rowHeight, node.height);
  });
}

// ---------- Button ----------

const BUTTON_SIZES = {
  default: { padding: 24, text: 16, icon: 16 },
  sm: { padding: 16, text: 13, icon: 16 },
  xs: { padding: 12, text: 13, icon: 14 },
  lg: { padding: 32, text: 16, icon: 16 },
  icon: { padding: 0, text: 0, icon: 16 },
};

const BUTTON_VARIANTS = {
  default: {
    fill: 'primary',
    text: 'primary-foreground',
    hover: { fill: 'primary', opacity: 0.8 },
  },
  outline: {
    fill: 'background',
    text: 'foreground',
    stroke: 'border',
    hover: { fill: 'muted' },
  },
  secondary: {
    fill: 'secondary',
    text: 'secondary-foreground',
    hover: { fill: 'secondary' },
  },
  ghost: { text: 'foreground', hover: { fill: 'muted' } },
  destructive: {
    fill: 'destructive',
    fillOpacity: 0.1,
    text: 'destructive-on-tint',
    hover: { fill: 'destructive', opacity: 0.2 },
  },
  link: { text: 'primary', underline: true, hover: {} },
  toggle: {
    fill: 'background',
    text: 'foreground',
    stroke: 'border',
    pill: true,
    hover: { fill: 'muted' },
  },
};

async function buttonNode(variantName, sizeName, state, label) {
  const variant = BUTTON_VARIANTS[variantName];
  const size = BUTTON_SIZES[sizeName];
  const hover = state === 'hover' ? variant.hover : null;
  const fillPath = hover?.fill ?? variant.fill;
  const fillOpacity = hover?.opacity ?? variant.fillOpacity ?? 1;
  const node = component(
    `variant=${variantName}, size=${sizeName}, state=${state}`,
    {
      mainAlign: 'CENTER',
      gap: 8,
      padding: [0, size.padding, 0, size.padding],
      mainSizing: sizeName === 'icon' ? 'FIXED' : 'AUTO',
      crossSizing: 'FIXED',
      radius: variant.pill ? 999 : 8,
      fill: fillPath ? paintFor(fillPath, fillOpacity) : undefined,
      stroke: variant.stroke ? paintFor(variant.stroke) : undefined,
    },
  );
  node.resize(sizeName === 'icon' ? 44 : 100, 44);
  bindNumber(node, 'height', 'control-height');
  if (sizeName === 'icon') {
    node.appendChild(await icon('pencil', size.icon, variant.text));
  } else {
    const text = await makeText(label, {
      size: size.text,
      weight: 'semibold',
      color: variant.text,
      lineHeight: 100,
    });
    if (variant.underline) text.textDecoration = 'UNDERLINE';
    node.appendChild(text);
  }
  if (state === 'disabled') node.opacity = 0.5;
  return node;
}

async function buildButtons() {
  const page = await preparePage(PAGE_NAMES.button);
  const nodes = [];
  const labels = {
    default: '저장',
    outline: '취소',
    secondary: '보조',
    ghost: '더 보기',
    destructive: '삭제',
    link: '자세히',
    toggle: '모집중',
  };
  for (const variantName of Object.keys(BUTTON_VARIANTS)) {
    for (const state of ['default', 'hover', 'disabled']) {
      for (const sizeName of Object.keys(BUTTON_SIZES)) {
        nodes.push(
          await buttonNode(variantName, sizeName, state, labels[variantName]),
        );
      }
    }
  }
  grid(nodes, Object.keys(BUTTON_SIZES).length, 24, 24);
  const set = figma.combineAsVariants(nodes, page);
  set.name = 'Button';
  set.description =
    '높이 44 고정(control-height). variant 7 × size 5 × state 3. 코드: components/ui/button.tsx';
  log(`Button ${nodes.length}변형`);
  return set;
}

// ---------- Badge ----------

const BADGE_VARIANTS = {
  recruiting: '모집중',
  closed: '마감',
  pending: '검토 대기',
  approved: '승인',
  rejected: '반려',
};

async function badgeNode(variantName, sizeName) {
  const large = sizeName === 'lg';
  const node = component(`variant=${variantName}, size=${sizeName}`, {
    mainAlign: 'CENTER',
    gap: 6,
    // 좌우 10 = 코드 기본 `px-2.5`. 12px 글자에 8은 너무 빡빡하다(동규 2026-09-19).
    padding: large ? [8, 16, 8, 16] : [0, 10, 0, 10],
    mainSizing: 'AUTO',
    crossSizing: large ? 'AUTO' : 'FIXED',
    radius: 999,
    fill: paintFor(`status.${variantName}.bg`),
  });
  if (!large) {
    node.resize(60, 26);
    bindNumber(node, 'height', 'tag-height');
  }
  const dot = figma.createEllipse();
  dot.name = 'dot';
  dot.resize(6, 6);
  dot.fills = [paintFor(`status.${variantName}.fg`)];
  node.appendChild(dot);
  node.appendChild(
    await makeText(BADGE_VARIANTS[variantName], {
      size: large ? 16 : 12,
      weight: 'semibold',
      color: `status.${variantName}.fg`,
      // text-xs의 줄 간격 1rem(16px) = 133%
      lineHeight: 133,
    }),
  );
  return node;
}

const VOCABULARY = [
  [
    '제출(서류)',
    'NOT_SUBMITTED / SUBMITTED / APPROVED / CHANGES_REQUESTED / REJECTED',
    '미제출 / 검토 대기 / 승인 / 보완 요청 / 반려',
    'closed / recruiting / approved / pending / rejected',
  ],
  [
    '신청',
    'SUBMITTED / APPROVED / REJECTED',
    '검토 대기 / 승인 / 반려',
    'pending / approved / rejected',
  ],
  [
    '역할',
    'STUDENT / STAFF / ADMIN / 없음',
    '학생 / 교직원 / 관리자 / 미지정',
    'closed / pending / approved / closed',
  ],
  ['계정', 'ACTIVE / DEACTIVATED', '활성 / 비활성', 'approved / closed'],
  [
    '프로그램 목록',
    'upcoming / recruiting / in_progress / ended',
    '예정 / 모집중 / 진행중 / 종료',
    'closed / recruiting / recruiting / closed',
  ],
];

async function buildBadges() {
  const page = await preparePage(PAGE_NAMES.badge);
  const nodes = [];
  for (const variantName of Object.keys(BADGE_VARIANTS)) {
    for (const sizeName of ['default', 'lg']) {
      nodes.push(await badgeNode(variantName, sizeName));
    }
  }
  grid(nodes, 2, 24, 24);
  const set = figma.combineAsVariants(nodes, page);
  set.name = 'StatusBadge';
  set.description =
    '높이 26(tag-height). 색·글자·점 세 신호. 코드: components/status-badge.tsx, 어휘: lib/status-vocabulary';

  const sheet = frame('용어 사전 — 같은 상태는 같은 말·같은 색', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 8,
    padding: [24, 24, 24, 24],
    radius: 12,
    fill: paintFor('card'),
    stroke: paintFor('border'),
  });
  sheet.appendChild(
    await makeText('용어 사전 (lib/status-vocabulary, 2026-09-19 결정)', {
      size: 16,
      weight: 'semibold',
    }),
  );
  for (const row of [['도메인', '값', '라벨', '배지'], ...VOCABULARY]) {
    const line = frame('row', { gap: 24, crossAlign: 'MIN' });
    for (const [index, cell] of row.entries()) {
      const text = await makeText(cell, {
        size: 13,
        weight: row[0] === '도메인' ? 'semibold' : 'regular',
        color: index === 0 ? 'foreground' : 'muted-foreground',
      });
      text.textAutoResize = 'HEIGHT';
      text.resize(index === 0 ? 120 : 260, text.height);
      line.appendChild(text);
    }
    sheet.appendChild(line);
  }
  sheet.x = set.x + set.width + 80;
  sheet.y = set.y;
  page.appendChild(sheet);
  log(`StatusBadge ${nodes.length}변형 + 용어 사전`);
  return set;
}

// ---------- Filter Chip ----------

async function buildChips() {
  const page = await preparePage(PAGE_NAMES.chip);
  const nodes = [];
  for (const state of ['default', 'hover', 'pressed']) {
    const pressed = state === 'pressed';
    const node = component(`state=${state}`, {
      mainAlign: 'CENTER',
      gap: 8,
      padding: [0, 16, 0, 16],
      crossSizing: 'FIXED',
      radius: 999,
      fill: paintFor(
        pressed ? 'primary' : state === 'hover' ? 'muted' : 'background',
      ),
      stroke: paintFor(pressed ? 'primary' : 'border'),
    });
    node.resize(80, 44);
    bindNumber(node, 'height', 'control-height');
    node.appendChild(
      await makeText('모집중', {
        size: 13,
        weight: 'semibold',
        color: pressed ? 'primary-foreground' : 'foreground',
        lineHeight: 100,
      }),
    );
    nodes.push(node);
  }
  grid(nodes, 3, 24, 24);
  const set = figma.combineAsVariants(nodes, page);
  set.name = 'FilterChip';
  set.description =
    'Button toggle 변형 + size sm. 눌림은 aria-pressed. 코드: components/filter-chip.tsx';

  const group = frame('예시 — 프로그램 목록 상태 필터', { gap: 8 });
  for (const [label, pressed] of [
    ['전체', true],
    ['모집중', false],
    ['진행중', false],
    ['종료', false],
  ]) {
    const instance = set.defaultVariant.createInstance();
    instance.setProperties({ state: pressed ? 'pressed' : 'default' });
    const text = instance.findOne((n) => n.type === 'TEXT');
    if (text) text.characters = label;
    group.appendChild(instance);
  }
  group.y = set.y + set.height + 48;
  page.appendChild(group);
  log('FilterChip 3상태 + 예시 묶음');
  return set;
}

// ---------- Dialog · Form ----------

async function formField(label, placeholder, help) {
  const field = component('Form/Field', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 8,
    crossSizing: 'FIXED',
  });
  field.resize(400, 10);
  field.primaryAxisSizingMode = 'AUTO';
  field.appendChild(await makeText(label, { size: 13, weight: 'semibold' }));
  const input = frame('input', {
    padding: [0, 12, 0, 12],
    crossSizing: 'FIXED',
    mainSizing: 'FIXED',
    radius: 8,
    fill: paintFor('background'),
    stroke: paintFor('input'),
  });
  input.resize(400, 44);
  input.appendChild(
    await makeText(placeholder, { size: 16, color: 'muted-foreground' }),
  );
  field.appendChild(input);
  input.layoutSizingHorizontal = 'FILL';
  field.appendChild(
    await makeText(help, { size: 13, color: 'muted-foreground' }),
  );
  return field;
}

async function buttonInstance(buttonSet, variant, label) {
  const instance = buttonSet.defaultVariant.createInstance();
  instance.setProperties({ variant, size: 'default', state: 'default' });
  const text = instance.findOne((n) => n.type === 'TEXT');
  if (text) text.characters = label;
  return instance;
}

async function dialogNode(size, buttonSet, fieldComponent) {
  const width = size === 'md' ? 576 : 672;
  const node = component(`Dialog/${size}`, {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 20,
    padding: [24, 24, 24, 24],
    crossSizing: 'FIXED',
    radius: 12,
    fill: paintFor('background'),
    stroke: paintFor('border'),
  });
  node.resize(width, 10);
  node.primaryAxisSizingMode = 'AUTO';
  node.effects = [
    {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.1 },
      offset: { x: 0, y: 10 },
      radius: 15,
      spread: -3,
      visible: true,
      blendMode: 'NORMAL',
    },
  ];
  const head = frame('head', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 4,
  });
  head.appendChild(
    await makeText('팀 이름 변경', { size: 18, weight: 'semibold' }),
  );
  head.appendChild(
    await makeText('새 이름을 입력하세요.', {
      size: 13,
      color: 'muted-foreground',
    }),
  );
  node.appendChild(head);
  const body = frame('body (위→아래 폼)', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 20,
  });
  node.appendChild(body);
  body.layoutSizingHorizontal = 'FILL';
  for (const count of size === 'lg' ? [1, 2] : [1]) {
    const field = fieldComponent.createInstance();
    field.name = `field ${count}`;
    body.appendChild(field);
    field.layoutSizingHorizontal = 'FILL';
  }
  const footer = frame('footer', { mainAlign: 'MAX', gap: 8 });
  footer.appendChild(await buttonInstance(buttonSet, 'outline', '취소'));
  footer.appendChild(await buttonInstance(buttonSet, 'default', '저장'));
  node.appendChild(footer);
  footer.layoutSizingHorizontal = 'FILL';
  return node;
}

async function buildDialogs(buttonSet) {
  const page = await preparePage(PAGE_NAMES.dialog);
  const field = await formField(
    '팀 이름',
    '가팀',
    '2~30자. 다른 팀과 겹치면 저장되지 않습니다.',
  );
  page.appendChild(field);
  const md = await dialogNode('md', buttonSet, field);
  const lg = await dialogNode('lg', buttonSet, field);
  page.appendChild(md);
  page.appendChild(lg);
  field.x = 0;
  md.x = 480;
  lg.x = 480;
  lg.y = md.height + 48;
  const overlay = frame('오버레이 (foreground 35%, 흐림 없음)', {
    crossSizing: 'FIXED',
    mainSizing: 'FIXED',
  });
  overlay.fills = [paintFor('foreground', 0.35)];
  overlay.resize(200, 120);
  overlay.x = 0;
  overlay.y = field.height + 48;
  page.appendChild(overlay);
  log('Dialog md·lg + Form/Field + 오버레이 견본');
}

// ---------- Table ----------

async function tableCell(kind, text, align = 'LEFT') {
  const isHead = kind !== 'cell';
  const node = component(
    kind === 'head'
      ? 'Table/HeaderCell'
      : kind === 'rowHead'
        ? 'Table/RowHeaderCell'
        : 'Table/Cell',
    {
      padding: [16, 24, 16, 24],
      mainAlign: align === 'RIGHT' ? 'MAX' : 'MIN',
      crossSizing: 'AUTO',
    },
  );
  node.appendChild(
    await makeText(text, {
      size: isHead ? 12 : 14,
      weight: isHead ? 'semibold' : 'regular',
      color: kind === 'head' ? 'muted-foreground' : 'foreground',
      lineHeight: isHead ? 100 : 145,
      letter: kind === 'head' ? 2 : 0,
      align,
    }),
  );
  return node;
}

async function buildTable() {
  const page = await preparePage(PAGE_NAMES.table);
  const head = await tableCell('head', '학과');
  const cell = await tableCell('cell', '인공지능학부');
  const rowHead = await tableCell('rowHead', '2026-09');
  [head, rowHead, cell].forEach((node, index) => {
    node.x = index * 260;
    page.appendChild(node);
  });

  const columns = [
    '학과',
    '구분',
    '학생',
    '활동',
    '참여',
    'Commit',
    'PR',
    'Issue',
    'Repo',
    'Star(누적)',
    '합계',
  ];
  const rows = [
    ['인공지능학부', 'SW전공', '1', '0', '0', '0', '0', '0', '0', '0', '0'],
    [
      '전자컴퓨터공학부',
      '비SW전공',
      '1',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
    ],
    ['소프트웨어공학과', 'SW전공', '1', '0', '1', '0', '0', '0', '0', '0', '0'],
  ];
  const table = frame('예시 — 학과별 활성 표 (DataTable)', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    radius: 8,
    fill: paintFor('card'),
    stroke: paintFor('border'),
  });
  const headerRow = frame('header row', { crossSizing: 'AUTO' });
  headerRow.strokes = [paintFor('border')];
  headerRow.strokeWeight = 1;
  headerRow.strokeTopWeight = 0;
  headerRow.strokeLeftWeight = 0;
  headerRow.strokeRightWeight = 0;
  headerRow.strokeBottomWeight = 1;
  for (const [index, column] of columns.entries()) {
    const instance = head.createInstance();
    const text = instance.findOne((n) => n.type === 'TEXT');
    if (text) text.characters = column;
    if (index >= 2) instance.primaryAxisAlignItems = 'MAX';
    instance.resize(index === 0 ? 200 : 110, instance.height);
    headerRow.appendChild(instance);
  }
  table.appendChild(headerRow);
  for (const [rowIndex, row] of rows.entries()) {
    const line = frame(`row ${rowIndex + 1}`, { crossSizing: 'FIXED' });
    line.resize(10, 76);
    line.primaryAxisSizingMode = 'AUTO';
    bindNumber(line, 'height', 'row-height');
    if (rowIndex < rows.length - 1) {
      line.strokes = [paintFor('border', 0.5)];
      line.strokeWeight = 1;
      line.strokeTopWeight = 0;
      line.strokeLeftWeight = 0;
      line.strokeRightWeight = 0;
      line.strokeBottomWeight = 1;
    }
    for (const [index, value] of row.entries()) {
      const instance = cell.createInstance();
      const text = instance.findOne((n) => n.type === 'TEXT');
      if (text) text.characters = value;
      if (index >= 2) instance.primaryAxisAlignItems = 'MAX';
      instance.resize(index === 0 ? 200 : 110, instance.height);
      line.appendChild(instance);
    }
    table.appendChild(line);
  }
  table.y = head.height + 48;
  page.appendChild(table);
  log('Table 셀 3종 + 예시 표');
}

// ---------- Card ----------

async function buildCards(buttonSet) {
  const page = await preparePage(PAGE_NAMES.card);
  const card = component('Card', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 24,
    padding: [24, 24, 24, 24],
    crossSizing: 'FIXED',
    radius: 12,
    fill: paintFor('card'),
    stroke: paintFor('foreground', 0.1),
  });
  card.resize(360, 10);
  card.primaryAxisSizingMode = 'AUTO';
  const header = frame('header', {
    mainAlign: 'SPACE_BETWEEN',
    crossAlign: 'MIN',
    gap: 8,
  });
  const titles = frame('titles', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 4,
  });
  const title = await makeText('수강 신청 · 팀 등록', {
    size: 16,
    weight: 'semibold',
    letter: -1,
  });
  // 동규 2026-09-19: 기간은 한 줄에 짧게 「26.08.05 – 26.08.06 01:58」(연도 두 자리,
  // 마감 시각만 남김). 사이트 코드도 같은 규칙으로 맞춘다(후속 PR).
  const meta = await makeText('26.08.05 – 26.08.06 01:58', {
    size: 13,
    color: 'muted-foreground',
  });
  titles.appendChild(title);
  titles.appendChild(meta);
  header.appendChild(titles);
  const actions = frame('actions (RowActions)', { gap: 6 });
  for (const name of ['pencil', 'trash-2'])
    actions.appendChild(await iconButton(name));
  header.appendChild(actions);
  card.appendChild(header);
  header.layoutSizingHorizontal = 'FILL';
  // 코드의 CardHeader는 grid-cols-[1fr_auto]다 — 제목 묶음이 남는 폭을 채우고 글이
  // 줄바꿈하며, 오른쪽 액션은 제 크기를 지킨다. 안 그러면 긴 제목이 액션을 밀어내 잘린다.
  titles.layoutSizingHorizontal = 'FILL';
  for (const text of [title, meta]) {
    text.textAutoResize = 'HEIGHT';
    text.layoutSizingHorizontal = 'FILL';
  }
  const content = frame('content', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 4,
  });
  content.appendChild(
    await makeText('운영자 공지', {
      size: 12,
      weight: 'semibold',
      color: 'muted-foreground',
    }),
  );
  content.appendChild(
    await makeText('팀을 만들거나 모집 중인 팀에 들어갑니다.', { size: 13 }),
  );
  card.appendChild(content);
  content.layoutSizingHorizontal = 'FILL';
  const footer = frame('footer', { gap: 8 });
  footer.appendChild(await buttonInstance(buttonSet, 'default', '우리 팀'));
  footer.appendChild(await buttonInstance(buttonSet, 'outline', '제출 현황'));
  card.appendChild(footer);
  page.appendChild(card);
  log('Card (머리·내용·바닥·행 액션)');
}

// ---------- Tokens 페이지 · Cover ----------

async function buildTokenSheet(tokens) {
  const page = await preparePage(PAGE_NAMES.tokens);
  const sheet = frame('팔레트', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 12,
  });
  for (const [hue, steps] of Object.entries(tokens.primitive.palette)) {
    const row = frame(hue, { gap: 8, crossAlign: 'MIN' });
    const entries = 'value' in steps ? [[hue, steps]] : Object.entries(steps);
    for (const [step, token] of entries) {
      const swatch = frame(`${hue}-${step}`, {
        direction: 'VERTICAL',
        crossAlign: 'MIN',
        gap: 4,
      });
      const chip = figma.createRectangle();
      chip.resize(72, 40);
      chip.cornerRadius = 8;
      chip.fills = [
        paintFor(
          'value' in steps ? `palette.${hue}` : `palette.${hue}.${step}`,
        ),
      ];
      swatch.appendChild(chip);
      swatch.appendChild(
        await makeText(`${step}\n${token.value}`, {
          size: 11,
          color: 'muted-foreground',
          lineHeight: 130,
        }),
      );
      row.appendChild(swatch);
    }
    sheet.appendChild(row);
  }
  page.appendChild(sheet);
  const scale = frame('간격 척도', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 8,
  });
  for (const [step, token] of Object.entries(tokens.dimension.space)) {
    const row = frame(`space-${step}`, { gap: 12 });
    const bar = figma.createRectangle();
    bar.resize(parseNumber(token.value) ?? 4, 12);
    bar.fills = [paintFor('primary')];
    row.appendChild(bar);
    row.appendChild(
      await makeText(`space/${step} = ${token.value}`, {
        size: 13,
        color: 'muted-foreground',
      }),
    );
    scale.appendChild(row);
  }
  scale.y = sheet.height + 48;
  page.appendChild(scale);
  log('Tokens 페이지 (팔레트 · 간격 척도)');
}

async function buildCover() {
  const page = await preparePage(PAGE_NAMES.cover);
  const cover = frame('Cover', {
    direction: 'VERTICAL',
    crossAlign: 'MIN',
    gap: 12,
    padding: [48, 48, 48, 48],
    fill: paintFor('background'),
  });
  cover.appendChild(
    await makeText('OSS Hub 디자인 시스템', {
      size: 40,
      weight: 'semibold',
      letter: -1,
      lineHeight: 120,
    }),
  );
  cover.appendChild(
    await makeText(
      '원본은 코드다(apps/frontend/src/app/globals.css · components). 이 파일은 플러그인이 그린 거울이며, 값이 다르면 코드가 맞다.',
      { size: 16, color: 'muted-foreground' },
    ),
  );
  cover.appendChild(
    await makeText(`생성: ${new Date().toISOString().slice(0, 10)}`, {
      size: 13,
      color: 'muted-foreground',
    }),
  );
  page.appendChild(cover);
}

// ---------- 실행 ----------

async function loadTokens(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`tokens.json을 못 읽었다 (${response.status}) — ${url}`);
  const tokens = await response.json();
  if (!tokens.primitive || !tokens.light)
    throw new Error('tokens.json 형식이 아니다 (primitive·light 세트 없음)');
  return tokens;
}

async function run(url, steps) {
  const tokens = await loadTokens(url);
  log(
    `tokens.json 읽음: primitive ${flatten(tokens.primitive).length} · dimension ${flatten(tokens.dimension).length} · light ${flatten(tokens.light).length} · dark ${flatten(tokens.dark).length}`,
  );
  tokenIndex = new Map([
    ...flatten(tokens.primitive),
    ...flatten(tokens.dimension),
    ...flatten(tokens.light),
  ]);
  darkIndex = new Map(flatten(tokens.dark));
  await resolveFont();
  if (steps.variables) {
    await createVariables(tokens);
    await createTextStyles();
  } else {
    // 컴포넌트만 다시 그릴 때도 기존 변수를 경로로 찾아 둔다.
    for (const variable of await figma.variables.getLocalVariablesAsync()) {
      const key = variable.name.replace(/^semantic\//, '').replace(/\//g, '.');
      if (key.includes('@')) tintVariables.set(key, variable);
      else variablesByPath.set(key, variable);
    }
    for (const style of await figma.getLocalTextStylesAsync())
      textStyles.set(style.name, style);
  }
  if (steps.components) {
    await buildCover();
    await buildTokenSheet(tokens);
    const buttonSet = await buildButtons();
    await buildBadges();
    await buildChips();
    await buildDialogs(buttonSet);
    await buildTable();
    await buildCards(buttonSet);
    layoutSections();
  }
  figma.notify('OSS Hub 디자인 라이브러리 생성 완료');
  log('완료. 각 페이지를 열어 확인한다.');
}

figma.showUI(__html__, { width: 440, height: 380 });
figma.ui.onmessage = async (message) => {
  if (message.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (message.type !== 'run') return;
  try {
    await run(message.url, message.steps);
  } catch (error) {
    log(`실패: ${error instanceof Error ? error.message : String(error)}`);
    figma.notify('생성 실패 — 플러그인 창의 기록을 본다', { error: true });
  } finally {
    figma.ui.postMessage({ type: 'done' });
  }
};
