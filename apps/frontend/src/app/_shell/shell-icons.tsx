/**
 * 셸 아이콘 — 사이드바 메뉴마다 하나씩. 접힌 사이드바에서는 사용자가 이것만 보고
 * 이동하므로 장식이 아니라 식별 수단이다.
 *
 * 확정된 미감 시안 v2의 path 데이터를 그대로 옮겼다. `lucide-react`를 쓰지 않는
 * 이유는 시안이 정한 stroke-width(1.7)·viewBox·모양을 그대로 재현하기 위해서다.
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
  /** 모집 중 — 확성기 */
  megaphone: (
    <>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l6 4V6L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M15 9.5a4 4 0 0 1 0 5" />
      <path d="M17.5 7a7 7 0 0 1 0 10" />
    </>
  ),
  /** 진행 중 — 재생 */
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l6-3.5z" />
    </>
  ),
  /** 대기 — 시계 */
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  /** 종료 — 체크 원 */
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  /** 레이어 / 융합 */
  layers: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 16l9 5 9-5" />
    </>
  ),
  /** 지구 / 글로벌 */
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </>
  ),
  /** 코드 브라켓 */
  code: (
    <>
      <path d="M8 8 4 12l4 4" />
      <path d="M16 8l4 4-4 4" />
      <path d="M14 6l-4 12" />
    </>
  ),
  /** 건물 / 기업 */
  building: (
    <>
      <path d="M4 21V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16" />
      <path d="M16 10h3a1 1 0 0 1 1 1v10" />
      <path d="M8 8h2M8 12h2M8 16h2M13 8h1M13 12h1M13 16h1" />
      <path d="M2 21h20" />
    </>
  ),
  /** 트로피 / 경진 */
  trophy: (
    <>
      <path d="M8 4h8v4a4 4 0 0 1-8 0z" />
      <path d="M8 6H5a2 2 0 0 0 2 4" />
      <path d="M16 6h3a2 2 0 0 1-2 4" />
      <path d="M12 12v3" />
      <path d="M9 21h6M10 15h4v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z" />
    </>
  ),
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
} as const;

export type ShellIconName = keyof typeof ICON_PATHS;

/**
 * `aria-hidden`이 기본이다 — 아이콘 옆에는 항상 이름표 또는 툴팁이 함께 있다.
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
