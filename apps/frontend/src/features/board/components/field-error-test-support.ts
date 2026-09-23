/**
 * 정적 마크업에서 **그 칸에 걸린** 속성과 **그 오류 요소 안의** 문구를 꺼낸다.
 *
 * `expect(html).toContain('제목을 입력해 주세요.')`는 문구가 화면 어딘가에 있다는 것만
 * 말한다 — 떨어진 경고 상자에 있어도 통과한다. 칸과 오류가 이어졌는지는 칸의
 * `aria-describedby`가 가리키는 id의 요소를 직접 집어야 판정할 수 있다.
 */
export function openingTag(html: string, id: string): string {
  const match = new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`).exec(html);
  if (!match) throw new TypeError(`id="${id}" 요소를 찾지 못했습니다.`);
  return match[0];
}

export function textOf(html: string, id: string): string {
  const match = new RegExp(`<([a-z]+)[^>]*\\sid="${id}"[^>]*>(.*?)</\\1>`).exec(
    html,
  );
  if (!match) throw new TypeError(`id="${id}" 요소를 찾지 못했습니다.`);
  return match[2] ?? '';
}
