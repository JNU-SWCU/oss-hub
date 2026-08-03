/**
 * 가입 동선 무대의 별밭(#517).
 *
 * 랜딩의 canvas 렌더 루프는 가져오지 않는다. 그것은 스크롤을 따라 카메라를 움직이는
 * 장치라 별 위치가 매 프레임 다시 계산되는데, 가입 폼에는 움직일 카메라가 없다.
 * 여기서는 같은 팔레트로 별 위치만 한 번 정해 정적 SVG 한 장으로 굳힌다 — 렌더 루프도
 * canvas도 없고, 화질 거버너(`cosmos-quality.ts`)가 재는 프레임 예산에도 들어가지
 * 않는다.
 *
 * 불변식 둘.
 * - 위치는 고정 seed에서 나온다. 매 렌더 다시 뽑으면 서버와 브라우저의 별자리가 달라져
 *   hydration이 갈린다.
 * - `slice`로 덮으므로 viewBox는 정사각형이어야 한다. 어느 폭에서도 별이 한쪽으로
 *   몰리거나 늘어나지 않는 것이 이 화면의 요구였다.
 */

const VIEW_BOX_SIZE = 1000;

/** mulberry32 — 값이 고정돼야 하므로 `Math.random`을 쓰지 않는다. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 한 층의 별을 점 하나짜리 subpath 목록으로 그린다. `stroke-linecap="round"` 덕에
 * 길이 0에 가까운 선이 동그란 점이 된다 — 별 하나에 요소 하나를 두지 않아도 된다.
 */
function buildLayerPath(count: number, random: () => number): string {
  let path = '';
  for (let index = 0; index < count; index += 1) {
    const x = (random() * VIEW_BOX_SIZE).toFixed(1);
    const y = (random() * VIEW_BOX_SIZE).toFixed(1);
    path += `M${x} ${y}h.01`;
  }
  return path;
}

const random = createRandom(0x51701);

/** 층마다 크기·밝기가 다르다 — 랜딩의 배경 별 3층과 같은 구성이다. */
const STAR_LAYERS = [
  { count: 380, width: 0.9, opacity: 0.28 },
  { count: 190, width: 1.5, opacity: 0.42 },
  { count: 85, width: 2.6, opacity: 0.6 },
].map((layer) => ({ ...layer, path: buildLayerPath(layer.count, random) }));

export function SignupStarfield() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full text-cosmos-copy"
      viewBox={`0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {STAR_LAYERS.map((layer) => (
        <path
          key={layer.width}
          d={layer.path}
          stroke="currentColor"
          strokeWidth={layer.width}
          strokeLinecap="round"
          opacity={layer.opacity}
        />
      ))}
    </svg>
  );
}
