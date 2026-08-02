/**
 * 셸 아이콘 — 사이드바 메뉴마다 하나씩. 접힌 사이드바에서는 사용자가 이것만 보고
 * 이동하므로 장식이 아니라 식별 수단이다.
 *
 * 확정된 미감 시안 v2의 path 데이터를 그대로 옮겼다. `lucide-react`를 쓰지 않는
 * 이유는 시안이 정한 stroke-width(1.7)·viewBox·모양을 그대로 재현하기 위해서다 —
 * 아이콘마다 라이브러리 이름을 짝지어 두면 시안과 제품이 조용히 갈라진다.
 */

const ICON_PATHS = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1" />
      <circle cx="3.5" cy="12" r="1" />
      <circle cx="3.5" cy="18" r="1" />
    </>
  ),
  detail: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v10h14V9" />
      <path d="M10 13h4" />
    </>
  ),
  repo: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z" />
      <path d="M8 3v14" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 6.5a3 3 0 0 1 0 5.8" />
      <path d="M18 20a6 6 0 0 0-2-4.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13h5l2 3h4l2-3h5" />
      <path d="M4 6h16l1 7v5H3v-5z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  pulse: <path d="M3 12h4l2-5 3 10 2-5h7" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>
  ),
  /** 사이드바 접기 — 펼쳐진 상태에서 왼쪽을 가리킨다 */
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  /** 좁은 화면의 상단 메뉴 열기 */
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
} as const;

export type ShellIconName = keyof typeof ICON_PATHS;

/**
 * `aria-hidden`이 기본이다 — 아이콘 옆에는 항상 이름표(펼침) 또는 툴팁·aria-label
 * (접힘)이 함께 있으므로 아이콘 자체를 접근성 트리에 두면 이름이 두 번 읽힌다.
 */
export function ShellIcon({
  name,
  className,
}: {
  readonly name: ShellIconName;
  readonly className?: string;
}) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'size-5 shrink-0'}
      data-icon={name}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
