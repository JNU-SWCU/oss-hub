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
